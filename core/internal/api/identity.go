package api

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/store"
)

const (
	componentAudience = "archura-checkout"
	componentTokenTTL = 10 * time.Minute
)

var (
	slugPattern      = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
	componentPattern = regexp.MustCompile(`^cmp_(?:test|live)_[A-Za-z0-9_-]{20,}$`)
)

type createClientRequest struct {
	Name           string   `json:"name"`
	Slug           string   `json:"slug"`
	AllowedOrigins []string `json:"allowed_origins"`
}

func (s *Server) handleCreateClient(w http.ResponseWriter, r *http.Request) {
	if !s.authenticatePlatformAdmin(r) {
		s.securityEvent(r, "invalid_platform_admin_key")
		writeError(w, r, http.StatusUnauthorized, "invalid_api_key", "The platform admin key is invalid.")
		return
	}
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return
	}
	if !s.enforceRateLimit(w, r, "platform", "client.create", clientCreateLimit) {
		return
	}

	var input createClientRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Slug = strings.TrimSpace(input.Slug)
	if input.Name == "" || !slugPattern.MatchString(input.Slug) || !validOrigins(input.AllowedOrigins, s.cfg.Env) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "Name, slug, or allowed origins are invalid.")
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
	tenant, err := s.store.CreateTenant(r.Context(), store.CreateTenantParams{
		Name: input.Name, Slug: input.Slug, AllowedOrigins: input.AllowedOrigins,
		PublishableKey: publishableKey, SecretKeyHash: archauth.Hash(secretKey),
	}, store.AuditEvent{
		ActorType: "platform_admin", Action: "client.created",
		ResourceType: "client", RequestID: middleware.GetReqID(r.Context()),
	})
	if errors.Is(err, store.ErrConflict) {
		writeError(w, r, http.StatusConflict, "client_exists", "A client with that slug already exists.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if metadata := metadataFromRequest(r); metadata != nil {
		metadata.TenantID = tenant.ID
	}
	s.log.InfoContext(r.Context(), "client created",
		"event", "client_created", "request_id", middleware.GetReqID(r.Context()), "tenant_id", tenant.ID)

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": tenant.ID, "name": tenant.Name, "slug": tenant.Slug,
		"publishable_key": publishableKey, "secret_key": secretKey,
		"created_at": tenant.CreatedAt,
	})
}

type putComponentRequest struct {
	Mode           string   `json:"mode"`
	StripePriceID  string   `json:"stripe_price_id"`
	SuccessURL     string   `json:"success_url"`
	CancelURL      string   `json:"cancel_url"`
	AllowedOrigins []string `json:"allowed_origins"`
	Status         string   `json:"status"`
}

func (s *Server) handleCreateComponent(w http.ResponseWriter, r *http.Request) {
	tenant, ok := s.authenticateTenant(w, r)
	if !ok {
		return
	}
	if !s.enforceRateLimit(w, r, tenant.ID, "component.write", componentWriteLimit) {
		return
	}
	componentID, err := archauth.Generate("cmp", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.saveComponent(w, r, tenant, componentID, http.StatusCreated)
}

func (s *Server) handlePutComponent(w http.ResponseWriter, r *http.Request) {
	tenant, ok := s.authenticateTenant(w, r)
	if !ok {
		return
	}
	if !s.enforceRateLimit(w, r, tenant.ID, "component.write", componentWriteLimit) {
		return
	}
	componentID := chi.URLParam(r, "componentID")
	if !componentPattern.MatchString(componentID) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The component ID is invalid.")
		return
	}
	s.saveComponent(w, r, tenant, componentID, http.StatusOK)
}

func (s *Server) saveComponent(w http.ResponseWriter, r *http.Request, tenant store.Tenant, componentID string, status int) {
	var input putComponentRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	if input.Status == "" {
		input.Status = "active"
	}
	if (input.Mode != "payment" && input.Mode != "subscription") ||
		!strings.HasPrefix(input.StripePriceID, "price_") ||
		(input.Status != "active" && input.Status != "inactive") ||
		!validOrigins(input.AllowedOrigins, s.cfg.Env) ||
		!originsSubset(input.AllowedOrigins, tenant.AllowedOrigins) ||
		!urlMatchesOrigins(input.SuccessURL, input.AllowedOrigins) ||
		!urlMatchesOrigins(input.CancelURL, input.AllowedOrigins) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The component configuration is invalid.")
		return
	}

	action := "component.updated"
	if status == http.StatusCreated {
		action = "component.created"
	}
	component, err := s.store.UpsertPaymentComponent(r.Context(), store.PaymentComponent{
		ID: componentID, TenantID: tenant.ID, Mode: input.Mode,
		StripePriceID: input.StripePriceID, SuccessURL: input.SuccessURL,
		CancelURL: input.CancelURL, AllowedOrigins: input.AllowedOrigins, Status: input.Status,
	}, store.AuditEvent{
		TenantID: tenant.ID, ActorType: "tenant", ActorID: tenant.ID,
		Action: action, ResourceType: "component", ResourceID: componentID,
		RequestID: middleware.GetReqID(r.Context()),
		Metadata:  store.ComponentAuditMetadata{Mode: input.Mode, Status: input.Status},
	})
	if errors.Is(err, store.ErrNotFound) {
		s.securityEvent(r, "component_tenant_mismatch")
		writeError(w, r, http.StatusNotFound, "component_not_found", "The component was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if metadata := metadataFromRequest(r); metadata != nil {
		metadata.ComponentID = component.ID
	}
	s.log.InfoContext(r.Context(), "component configured",
		"event", "component_configured", "request_id", middleware.GetReqID(r.Context()),
		"tenant_id", tenant.ID, "component_id", component.ID)
	writeJSON(w, status, componentResponse(component))
}

type createComponentSessionRequest struct {
	ComponentID    string `json:"component_id"`
	ExternalUserID string `json:"external_user_id,omitempty"`
	Origin         string `json:"origin"`
}

func (s *Server) handleCreateComponentSession(w http.ResponseWriter, r *http.Request) {
	tenant, ok := s.authenticateTenant(w, r)
	if !ok {
		return
	}
	if !s.enforceRateLimit(w, r, tenant.ID, "component_session.create", componentSessionCreateLimit) {
		return
	}
	var input createComponentSessionRequest
	if err := decodeJSON(w, r, &input); err != nil || !componentPattern.MatchString(input.ComponentID) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	component, err := s.store.PaymentComponentForTenant(r.Context(), tenant.ID, input.ComponentID)
	if errors.Is(err, store.ErrNotFound) {
		s.securityEvent(r, "component_tenant_mismatch")
		writeError(w, r, http.StatusNotFound, "component_not_found", "The component was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if metadata := metadataFromRequest(r); metadata != nil {
		metadata.ComponentID = component.ID
	}
	if !slices.Contains(component.AllowedOrigins, input.Origin) {
		s.securityEvent(r, "component_origin_rejected")
		writeError(w, r, http.StatusForbidden, "origin_not_allowed", "The origin is not allowed for this component.")
		return
	}

	token, err := archauth.Generate("ct", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	sessionID, err := archauth.Generate("ses", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	expiresAt := time.Now().UTC().Add(componentTokenTTL)
	_, err = s.store.CreateComponentSession(r.Context(), store.ComponentSession{
		ID: sessionID, TokenHash: archauth.Hash(token), TenantID: tenant.ID,
		ComponentID: component.ID, ExternalUserID: strings.TrimSpace(input.ExternalUserID),
		Scopes: []string{"checkout:create"}, Audience: componentAudience,
		AllowedOrigin: input.Origin, ExpiresAt: expiresAt,
	}, store.AuditEvent{
		TenantID: tenant.ID, ActorType: "tenant", ActorID: tenant.ID,
		Action: "component_session.created", ResourceType: "component_session", ResourceID: sessionID,
		RequestID: middleware.GetReqID(r.Context()),
		Metadata: store.ComponentSessionAuditMetadata{
			Scopes: []string{"checkout:create"}, ExpiresInSeconds: int64(componentTokenTTL.Seconds()),
		},
	})
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	s.log.InfoContext(r.Context(), "component session created",
		"event", "component_session_created", "request_id", middleware.GetReqID(r.Context()),
		"tenant_id", tenant.ID, "component_id", component.ID)
	s.metrics.IncSessionCreated()

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, map[string]any{
		"access_token": token, "token_type": "Bearer",
		"expires_in": int(componentTokenTTL.Seconds()), "expires_at": expiresAt,
	})
}

func (s *Server) authenticatePlatformAdmin(r *http.Request) bool {
	token, ok := bearerToken(r)
	return ok && s.cfg.PlatformAdminKey != "" && archauth.Equal(token, s.cfg.PlatformAdminKey)
}

func (s *Server) authenticateTenant(w http.ResponseWriter, r *http.Request) (store.Tenant, bool) {
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return store.Tenant{}, false
	}
	token, ok := bearerToken(r)
	if !ok || !archauth.HasKindForEnv(token, "sk", s.cfg.Env) {
		s.securityEvent(r, "invalid_tenant_key")
		writeError(w, r, http.StatusUnauthorized, "invalid_api_key", "The tenant API key is invalid.")
		return store.Tenant{}, false
	}
	tenant, err := s.store.TenantBySecretHash(r.Context(), archauth.Hash(token))
	if errors.Is(err, store.ErrNotFound) {
		s.securityEvent(r, "invalid_tenant_key")
		writeError(w, r, http.StatusUnauthorized, "invalid_api_key", "The tenant API key is invalid.")
		return store.Tenant{}, false
	}
	if err != nil {
		s.internalError(w, r, err)
		return store.Tenant{}, false
	}
	if metadata := metadataFromRequest(r); metadata != nil {
		metadata.TenantID = tenant.ID
	}
	return tenant, true
}

func (s *Server) authenticateComponentSession(w http.ResponseWriter, r *http.Request, requiredScope string) (store.ComponentSession, bool) {
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return store.ComponentSession{}, false
	}
	token, ok := bearerToken(r)
	if !ok || !archauth.HasKindForEnv(token, "ct", s.cfg.Env) {
		s.securityEvent(r, "invalid_component_token")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The component session is invalid.")
		return store.ComponentSession{}, false
	}
	session, err := s.store.ComponentSessionByTokenHash(r.Context(), archauth.Hash(token))
	if errors.Is(err, store.ErrNotFound) || session.RevokedAt != nil || session.Audience != componentAudience {
		s.securityEvent(r, "invalid_component_token")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The component session is invalid.")
		return store.ComponentSession{}, false
	}
	if err != nil {
		s.internalError(w, r, err)
		return store.ComponentSession{}, false
	}
	if !session.ExpiresAt.After(time.Now()) {
		s.securityEvent(r, "expired_component_token")
		writeError(w, r, http.StatusUnauthorized, "token_expired", "The component session has expired.")
		return store.ComponentSession{}, false
	}
	if !slices.Contains(session.Scopes, requiredScope) {
		s.securityEvent(r, "insufficient_component_scope")
		writeError(w, r, http.StatusForbidden, "insufficient_scope", "The component session does not allow this action.")
		return store.ComponentSession{}, false
	}
	if r.Header.Get("Origin") != session.AllowedOrigin {
		s.securityEvent(r, "component_origin_rejected")
		writeError(w, r, http.StatusForbidden, "origin_not_allowed", "The origin is not allowed for this component session.")
		return store.ComponentSession{}, false
	}
	if metadata := metadataFromRequest(r); metadata != nil {
		metadata.TenantID = session.TenantID
		metadata.ComponentID = session.ComponentID
	}
	return session, true
}

func bearerToken(r *http.Request) (string, bool) {
	parts := strings.SplitN(r.Header.Get("Authorization"), " ", 2)
	returnValue := ""
	if len(parts) == 2 {
		returnValue = strings.TrimSpace(parts[1])
	}
	return returnValue, len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") && returnValue != ""
}

func validOrigins(origins []string, env string) bool {
	if len(origins) == 0 {
		return false
	}
	for _, origin := range origins {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" || origin != parsed.Scheme+"://"+parsed.Host {
			return false
		}
		if parsed.Scheme != "https" && !(env != "prod" && parsed.Scheme == "http") {
			return false
		}
	}
	return true
}

func originsSubset(origins, allowed []string) bool {
	for _, origin := range origins {
		if !slices.Contains(allowed, origin) {
			return false
		}
	}
	return true
}

func urlMatchesOrigins(value string, origins []string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	origin := parsed.Scheme + "://" + parsed.Host
	return slices.Contains(origins, origin)
}

func componentResponse(component store.PaymentComponent) map[string]any {
	return map[string]any{
		"id": component.ID, "mode": component.Mode, "stripe_price_id": component.StripePriceID,
		"success_url": component.SuccessURL, "cancel_url": component.CancelURL,
		"allowed_origins": component.AllowedOrigins, "status": component.Status,
		"created_at": component.CreatedAt, "updated_at": component.UpdatedAt,
	}
}

func (s *Server) internalError(w http.ResponseWriter, r *http.Request, err error) {
	s.log.Error("request failed", "request_id", middleware.GetReqID(r.Context()), "err", err)
	writeError(w, r, http.StatusInternalServerError, "internal_error", "The request could not be completed.")
}
