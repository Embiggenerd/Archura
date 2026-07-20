package api

import (
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/store"
)

const (
	confirmationTTL       = time.Hour
	accountSessionTTL     = 7 * 24 * time.Hour
	confirmationRateLimit = 5
	devMailboxLimit       = 50
)

type createConfirmationRequest struct {
	Email     string `json:"email"`
	Subdomain string `json:"subdomain,omitempty"`
}

type verifyConfirmationRequest struct {
	Token string `json:"token"`
}

type bindSiteOwnershipRequest struct {
	Subdomain      string `json:"subdomain"`
	OrganizationID string `json:"organization_id,omitempty"`
}

type createOrganizationRequest struct {
	Name           string   `json:"name"`
	Slug           string   `json:"slug"`
	AllowedOrigins []string `json:"allowed_origins,omitempty"`
}

type pendingConfirmation struct {
	ID         string
	TokenHash  string
	Email      string
	Subdomain  *string
	ConfirmURL string
	CreatedAt  time.Time
	ExpiresAt  time.Time
	Used       bool
}

type confirmationOutbox struct {
	mu      sync.Mutex
	entries []pendingConfirmation
}

// confirmationDelivery is the seam for a future transactional email provider.
// The only implementation in this milestone is the development outbox.
type confirmationDelivery interface {
	deliver(pendingConfirmation)
	consumed(string)
}

func newConfirmationOutbox() *confirmationOutbox {
	return &confirmationOutbox{}
}

func (o *confirmationOutbox) deliver(entry pendingConfirmation) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.entries = append(o.entries, entry)
	if len(o.entries) > devMailboxLimit {
		o.entries = append([]pendingConfirmation(nil), o.entries[len(o.entries)-devMailboxLimit:]...)
	}
}

func (o *confirmationOutbox) consumed(tokenHash string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i := range o.entries {
		if o.entries[i].TokenHash == tokenHash {
			o.entries[i].Used = true
			return
		}
	}
}

func (o *confirmationOutbox) list(limit int) []pendingConfirmation {
	o.mu.Lock()
	defer o.mu.Unlock()
	if limit > len(o.entries) {
		limit = len(o.entries)
	}
	result := make([]pendingConfirmation, 0, limit)
	for i := len(o.entries) - 1; i >= len(o.entries)-limit; i-- {
		result = append(result, o.entries[i])
	}
	return result
}

func (s *Server) handleCreateConfirmation(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return
	}
	var input createConfirmationRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	email := normalizeEmail(input.Email)
	input.Subdomain = strings.TrimSpace(input.Subdomain)
	if !validEmail(email) || (input.Subdomain != "" && !slugPattern.MatchString(input.Subdomain)) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The email or subdomain is invalid.")
		return
	}
	clientIP := "unknown"
	if metadata := metadataFromRequest(r); metadata != nil && metadata.ClientIP != "" {
		clientIP = metadata.ClientIP
	}
	if !s.enforceRateLimits(w, r, []rateLimitRequest{
		{subject: "email:" + archauth.Hash(email), operation: "confirmation.create.email", limit: confirmationRateLimit, window: time.Hour},
		{subject: "ip:" + clientIP, operation: "confirmation.create.ip", limit: confirmationRateLimit, window: time.Hour},
	}) {
		return
	}
	var confirmURL string
	token, err := archauth.Generate("cfm", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if s.cfg.Env == "dev" {
		confirmURL, err = confirmationURL(s.cfg.ConfirmURLBase, token)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	expiresAt := time.Now().UTC().Add(confirmationTTL)
	var subdomain *string
	if input.Subdomain != "" {
		subdomain = &input.Subdomain
	}
	created, err := s.store.CreateConfirmation(r.Context(), store.EmailConfirmation{
		TokenHash: archauth.Hash(token), Email: email, Subdomain: subdomain, ExpiresAt: expiresAt,
	}, store.AuditEvent{
		ActorType: "anonymous", Action: "confirmation.created", ResourceType: "confirmation",
		RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if s.delivery != nil {
		s.delivery.deliver(pendingConfirmation{
			ID: created.ID, TokenHash: created.TokenHash, Email: created.Email,
			Subdomain: created.Subdomain, ConfirmURL: confirmURL,
			CreatedAt: created.CreatedAt, ExpiresAt: created.ExpiresAt,
		})
	}
	response := map[string]any{"id": created.ID, "expires_at": created.ExpiresAt}
	if s.cfg.Env == "dev" {
		response["confirm_url"] = confirmURL
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handleVerifyConfirmation(w http.ResponseWriter, r *http.Request) {
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return
	}
	var input verifyConfirmationRequest
	if err := decodeJSON(w, r, &input); err != nil || !archauth.HasKindForEnv(input.Token, "cfm", s.cfg.Env) {
		s.auditRejected(r, "confirmation.verify_rejected", "confirmation", "")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The confirmation token is invalid.")
		return
	}
	sessionToken, err := archauth.Generate("sess", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	publishableKey, err := archauth.Generate("pk", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	secretKey, err := archauth.Generate("sk", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	tokenHash := archauth.Hash(input.Token)
	result, err := s.store.VerifyConfirmation(r.Context(), store.VerifyConfirmationParams{
		TokenHash: tokenHash, SessionTokenHash: archauth.Hash(sessionToken),
		SessionExpiresAt: time.Now().UTC().Add(accountSessionTTL),
		PublishableKey:   publishableKey, SecretKeyHash: archauth.Hash(secretKey),
		RequestID: middleware.GetReqID(r.Context()),
	})
	if errors.Is(err, store.ErrNotFound) {
		s.auditRejected(r, "confirmation.verify_rejected", "confirmation", "")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The confirmation token is invalid.")
		return
	}
	if errors.Is(err, store.ErrConflict) {
		resourceID := ""
		if confirmation, lookupErr := s.store.ConfirmationByTokenHash(r.Context(), tokenHash); lookupErr == nil && confirmation.Subdomain != nil {
			resourceID = *confirmation.Subdomain
		}
		s.auditRejected(r, "site_ownership.rejected", "site", resourceID)
		writeError(w, r, http.StatusConflict, "site_owned", "The site is already owned by another account.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if s.delivery != nil {
		s.delivery.consumed(tokenHash)
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"account": map[string]any{"id": result.Account.ID, "email": result.Account.Email},
		"organization": organizationResponse(store.AccountOrganization{
			Organization: result.Organization, Role: "owner", IsDefault: true,
			PublishableKey: result.PublishableKey,
		}),
		"subdomain": result.Subdomain,
		"session":   map[string]any{"token": sessionToken, "expires_at": result.Session.ExpiresAt},
	})
}

func (s *Server) handleSessionMe(w http.ResponseWriter, r *http.Request) {
	account, ok := s.authenticateAccountSession(w, r)
	if !ok {
		return
	}
	organizations, err := s.store.OrganizationsForAccount(r.Context(), account.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	needsDefault := len(organizations) == 0
	for _, organization := range organizations {
		if organization.IsDefault && organization.PublishableKey == "" {
			needsDefault = true
		}
	}
	if needsDefault {
		publishableKey, keyErr := archauth.Generate("pk", s.cfg.Env)
		if keyErr != nil {
			s.internalError(w, r, keyErr)
			return
		}
		secretKey, keyErr := archauth.Generate("sk", s.cfg.Env)
		if keyErr != nil {
			s.internalError(w, r, keyErr)
			return
		}
		if _, err := s.store.EnsureDefaultOrganization(r.Context(), account, store.CreateOrganizationParams{
			PublishableKey: publishableKey, SecretKeyHash: archauth.Hash(secretKey), AllowedOrigins: []string{},
		}, middleware.GetReqID(r.Context())); err != nil {
			s.internalError(w, r, err)
			return
		}
		organizations, err = s.store.OrganizationsForAccount(r.Context(), account.ID)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
	}
	organizationBodies := make([]map[string]any, 0, len(organizations))
	for _, organization := range organizations {
		organizationBodies = append(organizationBodies, organizationResponse(organization))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"account":       map[string]any{"id": account.ID, "email": account.Email},
		"organizations": organizationBodies,
	})
}

func (s *Server) handleCreateOrganization(w http.ResponseWriter, r *http.Request) {
	account, ok := s.authenticateAccountSession(w, r)
	if !ok {
		return
	}
	var input createOrganizationRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = strings.TrimSpace(input.Slug)
	if input.Name == "" || !slugPattern.MatchString(input.Slug) ||
		(len(input.AllowedOrigins) > 0 && !validOrigins(input.AllowedOrigins, s.cfg.Env)) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The organization fields are invalid.")
		return
	}
	publishableKey, err := archauth.Generate("pk", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	secretKey, err := archauth.Generate("sk", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	organization, err := s.store.CreateOrganizationForAccount(r.Context(), account.ID, store.CreateOrganizationParams{
		Name: input.Name, Slug: input.Slug, AllowedOrigins: input.AllowedOrigins,
		PublishableKey: publishableKey, SecretKeyHash: archauth.Hash(secretKey),
	}, store.AuditEvent{
		ActorType: "account", ActorID: account.ID, Action: "organization.created",
		ResourceType: "organization", RequestID: middleware.GetReqID(r.Context()),
		Metadata: store.OrganizationAuditMetadata{},
	})
	if errors.Is(err, store.ErrConflict) {
		writeError(w, r, http.StatusConflict, "organization_exists", "An organization with that slug already exists.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	response := organizationResponse(organization)
	response["secret_key"] = secretKey
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, response)
}

func (s *Server) handleSessionLogout(w http.ResponseWriter, r *http.Request) {
	if s.store != nil {
		if token, ok := bearerToken(r); ok && archauth.HasKindForEnv(token, "sess", s.cfg.Env) {
			if err := s.store.RevokeSessionByTokenHash(r.Context(), archauth.Hash(token)); err != nil {
				s.log.ErrorContext(r.Context(), "account session revocation failed",
					"event", "account_session_revoke_failed",
					"request_id", middleware.GetReqID(r.Context()), "err", err)
			}
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleBindSiteOwnership(w http.ResponseWriter, r *http.Request) {
	account, ok := s.authenticateAccountSession(w, r)
	if !ok {
		return
	}
	var input bindSiteOwnershipRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	input.Subdomain = strings.TrimSpace(input.Subdomain)
	if !slugPattern.MatchString(input.Subdomain) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The subdomain is invalid.")
		return
	}
	organizations, err := s.store.OrganizationsForAccount(r.Context(), account.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" {
		for _, organization := range organizations {
			if organization.IsDefault {
				organizationID = organization.ID
				break
			}
		}
	}
	member := false
	for _, organization := range organizations {
		if organization.ID == organizationID {
			member = true
			break
		}
	}
	if !member {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	err = s.store.BindOrganizationSite(r.Context(), input.Subdomain, organizationID, account.ID, store.AuditEvent{
		ActorType: "account", ActorID: account.ID, Action: "site_ownership.bound",
		ResourceType: "site", ResourceID: input.Subdomain,
		RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	})
	if errors.Is(err, store.ErrConflict) {
		s.auditRejectedAsAccount(r, account.ID, "site_ownership.rejected", "site", input.Subdomain)
		writeError(w, r, http.StatusConflict, "site_owned", "The site is already owned by another account.")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{
		"subdomain": input.Subdomain, "organization_id": organizationID,
	})
}

func organizationResponse(organization store.AccountOrganization) map[string]any {
	return map[string]any{
		"id": organization.ID, "name": organization.Name, "slug": organization.Slug,
		"role": organization.Role, "is_default": organization.IsDefault,
		"publishable_key": organization.PublishableKey, "sites": organization.Sites,
		"created_at": organization.CreatedAt,
	}
}

func (s *Server) handleDevConfirmations(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Env != "dev" || s.devOutbox == nil {
		writeError(w, r, http.StatusNotFound, "not_found", "The resource was not found.")
		return
	}
	now := time.Now()
	entries := s.devOutbox.list(devMailboxLimit)
	confirmations := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		confirmations = append(confirmations, map[string]any{
			"email": entry.Email, "subdomain": entry.Subdomain,
			"confirm_url": entry.ConfirmURL, "created_at": entry.CreatedAt,
			"used": entry.Used, "expired": !entry.Used && !entry.ExpiresAt.After(now),
		})
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"confirmations": confirmations})
}

func (s *Server) authenticateAccountSession(w http.ResponseWriter, r *http.Request) (store.Account, bool) {
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return store.Account{}, false
	}
	token, ok := bearerToken(r)
	if !ok || !archauth.HasKindForEnv(token, "sess", s.cfg.Env) {
		s.securityEvent(r, "invalid_account_session")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The account session is invalid.")
		return store.Account{}, false
	}
	session, err := s.store.SessionByTokenHash(r.Context(), archauth.Hash(token))
	if errors.Is(err, store.ErrNotFound) {
		s.securityEvent(r, "invalid_account_session")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The account session is invalid.")
		return store.Account{}, false
	}
	if err != nil {
		s.internalError(w, r, err)
		return store.Account{}, false
	}
	account, err := s.store.AccountByID(r.Context(), session.AccountID)
	if errors.Is(err, store.ErrNotFound) {
		s.securityEvent(r, "invalid_account_session")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The account session is invalid.")
		return store.Account{}, false
	}
	if err != nil {
		s.internalError(w, r, err)
		return store.Account{}, false
	}
	return account, true
}

func (s *Server) auditRejected(r *http.Request, action, resourceType, resourceID string) {
	s.auditRejectedEvent(r, store.AuditEvent{
		ActorType: "anonymous", Action: action, ResourceType: resourceType, ResourceID: resourceID,
		Outcome: "rejected", RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	})
}

func (s *Server) auditRejectedAsAccount(r *http.Request, accountID, action, resourceType, resourceID string) {
	s.auditRejectedEvent(r, store.AuditEvent{
		ActorType: "account", ActorID: accountID, Action: action, ResourceType: resourceType, ResourceID: resourceID,
		Outcome: "rejected", RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	})
}

func (s *Server) auditRejectedEvent(r *http.Request, event store.AuditEvent) {
	if err := s.store.RecordAudit(r.Context(), event); err != nil {
		s.log.ErrorContext(r.Context(), "rejected request audit failed",
			"request_id", middleware.GetReqID(r.Context()), "action", event.Action, "err", err)
	}
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validEmail(value string) bool {
	if value == "" || strings.ContainsAny(value, "\r\n") {
		return false
	}
	address, err := mail.ParseAddress(value)
	return err == nil && address.Name == "" && address.Address == value && strings.Count(value, "@") == 1
}

func confirmationURL(base, token string) (string, error) {
	if strings.TrimSpace(base) == "" {
		return "", errors.New("CONFIRM_URL_BASE is required for development confirmations")
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("CONFIRM_URL_BASE must be an absolute URL")
	}
	query := parsed.Query()
	query.Set("token", token)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
