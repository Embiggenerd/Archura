// Package api wires the HTTP surface of the core server.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/archura/core/internal/config"
	"github.com/archura/core/internal/store"
	"github.com/archura/core/internal/telemetry"
)

type repository interface {
	Ping(context.Context) error
	CreateOrganization(context.Context, store.CreateOrganizationParams, store.AuditEvent) (store.Organization, error)
	OrganizationBySecretHash(context.Context, string) (store.Organization, error)
	UpsertPaymentComponent(context.Context, store.PaymentComponent, store.AuditEvent) (store.PaymentComponent, error)
	PaymentComponentForOrganization(context.Context, string, string) (store.PaymentComponent, error)
	CreateComponentSession(context.Context, store.ComponentSession, store.AuditEvent) (store.ComponentSession, error)
	ComponentSessionByTokenHash(context.Context, string) (store.ComponentSession, error)
	CreateConfirmation(context.Context, store.EmailConfirmation, store.AuditEvent) (store.EmailConfirmation, error)
	ConfirmationByTokenHash(context.Context, string) (store.EmailConfirmation, error)
	VerifyConfirmation(context.Context, store.VerifyConfirmationParams) (store.VerifyConfirmationResult, error)
	SessionByTokenHash(context.Context, string) (store.AccountSession, error)
	RevokeSessionByTokenHash(context.Context, string) error
	AccountByEmail(context.Context, string) (store.Account, error)
	AccountByID(context.Context, string) (store.Account, error)
	EnsureDefaultOrganization(context.Context, store.Account, store.CreateOrganizationParams, string) (store.AccountOrganization, error)
	OrganizationsForAccount(context.Context, string) ([]store.AccountOrganization, error)
	CreateOrganizationForAccount(context.Context, string, store.CreateOrganizationParams, store.AuditEvent) (store.AccountOrganization, error)
	CreateOrganizationInvitation(context.Context, string, string, string, time.Time, store.AuditEvent) (store.OrganizationInvitation, error)
	PendingInvitationsForEmail(context.Context, string) ([]store.OrganizationInvitation, error)
	RespondToOrganizationInvitation(context.Context, string, store.Account, bool, store.AuditEvent) (store.OrganizationInvitation, error)
	BindOrganizationSite(context.Context, string, string, string, store.AuditEvent) error
	ReleaseOrganizationSite(context.Context, string, string, store.AuditEvent) error
	SitesForAccount(context.Context, string) ([]string, error)
	BindSiteOwnership(context.Context, string, string, store.AuditEvent) error
	RecordAudit(context.Context, store.AuditEvent) error
	ConsumeRateLimit(context.Context, string, string, int, time.Duration) (store.RateLimitResult, error)
	BillingForOrganization(context.Context, string) (store.OrganizationBilling, error)
	CreateDesign(context.Context, string, string, string, store.AuditEvent) (store.Design, error)
	DesignsForOrganization(context.Context, string) ([]store.Design, error)
	DesignForOrganization(context.Context, string, string) (store.Design, error)
	StartOrganizationTrial(context.Context, string, time.Time, store.AuditEvent) (store.OrganizationBilling, error)
	SetStripeCustomer(context.Context, string, string) error
	UpdateStripeSubscription(context.Context, store.StripeSubscriptionUpdate, store.AuditEvent) error
	OrganizationIDByStripeCustomer(context.Context, string) (string, error)
	ClaimStripeWebhookEvent(context.Context, string, string, time.Time) (bool, error)
	FinishStripeWebhookEvent(context.Context, string, error) error
	DBStats() telemetry.DBStats
}

// Server holds the dependencies shared by handlers.
type Server struct {
	cfg             config.Config
	store           repository // nil when running without a database (local scaffold)
	log             *slog.Logger
	securitySampler *securityLogSampler
	metrics         *telemetry.Metrics
	devOutbox       *confirmationOutbox
	delivery        emailDelivery
	billing         billingProvider
	now             func() time.Time
}

func NewServer(cfg config.Config, st repository, log *slog.Logger) *Server {
	server := &Server{cfg: cfg, store: st, log: log, securitySampler: newSecurityLogSampler(), now: time.Now}
	if cfg.Env == "dev" {
		server.devOutbox = newConfirmationOutbox()
		server.delivery = server.devOutbox
	} else if cfg.EmailAccountID != "" && cfg.EmailAPIToken != "" && cfg.EmailFrom != "" {
		server.delivery = newCloudflareEmailDelivery(cfg.EmailAccountID, cfg.EmailAPIToken, cfg.EmailFrom)
	}
	if cfg.StripeSecretKey != "" {
		server.billing = newStripeBillingProvider(cfg.StripeSecretKey)
	}
	server.metrics = telemetry.New(func() telemetry.DBStats {
		if server.store == nil {
			return telemetry.DBStats{}
		}
		return server.store.DBStats()
	})
	return server
}

func (s *Server) MetricsHandler() http.Handler { return s.metrics }

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(s.initializeRequestMetadata)
	r.Use(s.accessLogger)
	r.Use(s.recoverer)
	r.Use(middleware.Timeout(15 * time.Second))

	r.Get("/healthz", s.handleHealthz) // liveness: process is up
	r.Get("/readyz", s.handleReadyz)   // readiness: dependencies (DB) reachable
	r.Get("/openapi.json", s.handleOpenAPI)
	r.Get("/docs", s.handleDocs)
	r.Get("/docs/", s.handleDocs)
	r.Get("/docs/swagger-initializer.js", s.handleSwaggerInitializer)
	r.Post("/stripe/webhooks", s.handleStripeWebhook)
	r.Route("/v1/admin", func(r chi.Router) {
		r.Use(s.requireAdminAPIEnabled)
		r.Use(s.requireEdgeAuthentication)
		r.Use(s.trustedClientIP)
		r.Use(s.requirePlatformOwner)
		r.Get("/organizations", s.handleAdminOrganizations)
		r.Get("/organizations/{organizationID}", s.handleAdminOrganization)
		r.Get("/organizations/{organizationID}/designs", s.handleAdminOrganizationDesigns)
		r.Get("/organizations/{organizationID}/members", s.handleAdminOrganizationMembers)
		r.Patch("/organizations/{organizationID}/free-plan", s.handleAdminPatchOrganizationPlan)
		r.Get("/designs/{designID}", s.handleAdminDesign)
		r.Post("/forks", s.handleAdminCreateFork)
		r.Post("/forks/{forkID}/finalize", s.handleAdminFinalizeFork)
		r.Get("/forks", s.handleAdminForks)
		r.Get("/default-plan", s.handleAdminDefaultPlan)
		r.Patch("/default-plan", s.handleAdminPatchDefaultPlan)
	})
	r.Route("/v1", func(r chi.Router) {
		r.Use(s.requireEdgeAuthentication)
		r.Use(s.trustedClientIP)
		r.Post("/clients", s.handleCreateClient)
		r.Post("/components", s.handleCreateComponent)
		r.Put("/components/{componentID}", s.handlePutComponent)
		r.Post("/component-sessions", s.handleCreateComponentSession)
		r.Post("/confirmations", s.handleCreateConfirmation)
		r.Post("/confirmations/verify", s.handleVerifyConfirmation)
		r.Get("/sessions/me", s.handleSessionMe)
		r.Post("/sessions/logout", s.handleSessionLogout)
		r.Post("/organizations", s.handleCreateOrganization)
		r.Post("/organizations/{organizationID}/invitations", s.handleCreateInvitation)
		r.Post("/organizations/{organizationID}/billing/start-trial", s.handleStartTrial)
		r.Get("/organizations/{organizationID}/entitlement", s.handleOrganizationEntitlement)
		r.Post("/organizations/{organizationID}/billing/checkout", s.handleBillingCheckout)
		r.Post("/organizations/{organizationID}/billing/portal", s.handleBillingPortal)
		r.Delete("/organizations/{organizationID}/sites/{subdomain}", s.handleReleaseOrganizationSite)
		r.Post("/organizations/{organizationID}/designs", s.handleCreateDesign)
		r.Get("/organizations/{organizationID}/designs", s.handleListDesigns)
		r.Get("/organizations/{organizationID}/designs/{designID}", s.handleGetDesign)
		r.Post("/invitations/{invitationID}/accept", s.handleAcceptInvitation)
		r.Post("/invitations/{invitationID}/decline", s.handleDeclineInvitation)
		r.Post("/site-ownership", s.handleBindSiteOwnership)
		r.Get("/dev/confirmations", s.handleDevConfirmations)
	})

	return r
}

type apiError struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id,omitempty"`
	} `json:"error"`
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	body := apiError{}
	body.Error.Code = code
	body.Error.Message = message
	body.Error.RequestID = middleware.GetReqID(r.Context())
	writeJSON(w, status, body)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
