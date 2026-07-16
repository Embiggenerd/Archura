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
	CreateTenant(context.Context, store.CreateTenantParams, store.AuditEvent) (store.Tenant, error)
	TenantBySecretHash(context.Context, string) (store.Tenant, error)
	UpsertPaymentComponent(context.Context, store.PaymentComponent, store.AuditEvent) (store.PaymentComponent, error)
	PaymentComponentForTenant(context.Context, string, string) (store.PaymentComponent, error)
	CreateComponentSession(context.Context, store.ComponentSession, store.AuditEvent) (store.ComponentSession, error)
	ComponentSessionByTokenHash(context.Context, string) (store.ComponentSession, error)
	ConsumeRateLimit(context.Context, string, string, int) (store.RateLimitResult, error)
	DBStats() telemetry.DBStats
}

// Server holds the dependencies shared by handlers.
type Server struct {
	cfg             config.Config
	store           repository // nil when running without a database (local scaffold)
	log             *slog.Logger
	securitySampler *securityLogSampler
	metrics         *telemetry.Metrics
}

func NewServer(cfg config.Config, st repository, log *slog.Logger) *Server {
	server := &Server{cfg: cfg, store: st, log: log, securitySampler: newSecurityLogSampler()}
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
	r.Route("/v1", func(r chi.Router) {
		r.Use(s.requireEdgeAuthentication)
		r.Use(s.trustedClientIP)
		r.Post("/clients", s.handleCreateClient)
		r.Post("/components", s.handleCreateComponent)
		r.Put("/components/{componentID}", s.handlePutComponent)
		r.Post("/component-sessions", s.handleCreateComponentSession)
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
