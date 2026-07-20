package api

import (
	"context"
	"errors"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/store"
)

const (
	confirmationTTL       = time.Hour
	accountSessionTTL     = 7 * 24 * time.Hour
	confirmationRateLimit = 5
	invitationRateLimit   = 20
	invitationTTL         = 7 * 24 * time.Hour
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

type createInvitationRequest struct {
	Email string `json:"email"`
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

type pendingInvitationEmail struct {
	InvitationID     string
	OrganizationID   string
	OrganizationName string
	Email            string
	InvitedByEmail   string
	AccountURL       string
	CreatedAt        time.Time
}

type confirmationOutbox struct {
	mu          sync.Mutex
	entries     []pendingConfirmation
	invitations []pendingInvitationEmail
}

type emailDelivery interface {
	deliverConfirmation(context.Context, pendingConfirmation) error
	deliverInvitation(context.Context, pendingInvitationEmail) error
	consumed(string)
}

func newConfirmationOutbox() *confirmationOutbox {
	return &confirmationOutbox{}
}

func (o *confirmationOutbox) deliverConfirmation(_ context.Context, entry pendingConfirmation) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.entries = append(o.entries, entry)
	if len(o.entries) > devMailboxLimit {
		o.entries = append([]pendingConfirmation(nil), o.entries[len(o.entries)-devMailboxLimit:]...)
	}
	return nil
}

// deliver keeps the small outbox unit-test seam while production delivery uses
// the context-aware emailDelivery interface.
func (o *confirmationOutbox) deliver(entry pendingConfirmation) {
	_ = o.deliverConfirmation(context.Background(), entry)
}

func (o *confirmationOutbox) deliverInvitation(_ context.Context, entry pendingInvitationEmail) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.invitations = append(o.invitations, entry)
	if len(o.invitations) > devMailboxLimit {
		o.invitations = append([]pendingInvitationEmail(nil), o.invitations[len(o.invitations)-devMailboxLimit:]...)
	}
	return nil
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

func (o *confirmationOutbox) listInvitations(limit int) []pendingInvitationEmail {
	o.mu.Lock()
	defer o.mu.Unlock()
	if limit > len(o.invitations) {
		limit = len(o.invitations)
	}
	result := make([]pendingInvitationEmail, 0, limit)
	for i := len(o.invitations) - 1; i >= len(o.invitations)-limit; i-- {
		result = append(result, o.invitations[i])
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
	token, err := archauth.Generate("cfm", s.cfg.Env)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	var confirmURL string
	if s.cfg.Env == "dev" || s.delivery != nil {
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
		if err := s.delivery.deliverConfirmation(r.Context(), pendingConfirmation{
			ID: created.ID, TokenHash: created.TokenHash, Email: created.Email,
			Subdomain: created.Subdomain, ConfirmURL: confirmURL,
			CreatedAt: created.CreatedAt, ExpiresAt: created.ExpiresAt,
		}); err != nil {
			s.internalError(w, r, err)
			return
		}
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
		"account": map[string]any{
			"id": result.Account.ID, "email": result.Account.Email,
			"email_verified_at": result.Account.EmailVerifiedAt,
		},
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
	invitations, err := s.store.PendingInvitationsForEmail(r.Context(), account.Email)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	invitationBodies := make([]map[string]any, 0, len(invitations))
	for _, invitation := range invitations {
		invitationBodies = append(invitationBodies, invitationResponse(invitation))
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"account": map[string]any{
			"id": account.ID, "email": account.Email, "email_verified_at": account.EmailVerifiedAt,
		},
		"organizations": organizationBodies,
		"invitations":   invitationBodies,
	})
}

func (s *Server) handleCreateInvitation(w http.ResponseWriter, r *http.Request) {
	account, ok := s.authenticateAccountSession(w, r)
	if !ok {
		return
	}
	organizationID := chi.URLParam(r, "organizationID")
	var input createInvitationRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	email := normalizeEmail(input.Email)
	if organizationID == "" || !validEmail(email) {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The invitation fields are invalid.")
		return
	}
	if !s.enforceRateLimits(w, r, []rateLimitRequest{
		{subject: "organization:" + organizationID, operation: "invitation.create.organization", limit: invitationRateLimit, window: time.Hour},
		{subject: "email:" + archauth.Hash(email), operation: "invitation.create.email", limit: invitationRateLimit, window: 24 * time.Hour},
	}) {
		return
	}
	invitation, err := s.store.CreateOrganizationInvitation(
		r.Context(), organizationID, account.ID, email, time.Now().UTC().Add(invitationTTL),
		store.AuditEvent{
			ActorType: "account", ActorID: account.ID, Action: "invitation.created",
			ResourceType: "invitation", RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
		},
	)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if errors.Is(err, store.ErrAlreadyMember) {
		writeError(w, r, http.StatusConflict, "already_member", "That account is already a member.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if s.delivery != nil {
		accountURL, urlErr := invitationURL(s.cfg.ConfirmURLBase, invitation.ID)
		if urlErr != nil {
			s.internalError(w, r, urlErr)
			return
		}
		if err := s.delivery.deliverInvitation(r.Context(), pendingInvitationEmail{
			InvitationID: invitation.ID, OrganizationID: invitation.OrganizationID,
			OrganizationName: invitation.OrganizationName, Email: invitation.Email,
			InvitedByEmail: account.Email, AccountURL: accountURL, CreatedAt: invitation.CreatedAt,
		}); err != nil {
			s.log.ErrorContext(r.Context(), "invitation email delivery failed",
				"request_id", middleware.GetReqID(r.Context()), "invitation_id", invitation.ID, "err", err)
			writeError(w, r, http.StatusBadGateway, "email_delivery_failed",
				"The invitation was saved, but its email could not be sent. Retry the invitation.")
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, invitationResponse(invitation))
}

func (s *Server) handleAcceptInvitation(w http.ResponseWriter, r *http.Request) {
	s.handleInvitationResponse(w, r, true)
}

func (s *Server) handleDeclineInvitation(w http.ResponseWriter, r *http.Request) {
	s.handleInvitationResponse(w, r, false)
}

func (s *Server) handleInvitationResponse(w http.ResponseWriter, r *http.Request, accept bool) {
	account, ok := s.authenticateAccountSession(w, r)
	if !ok {
		return
	}
	invitationID := chi.URLParam(r, "invitationID")
	if invitationID == "" {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The invitation is invalid.")
		return
	}
	invitation, err := s.store.RespondToOrganizationInvitation(r.Context(), invitationID, account, accept, store.AuditEvent{
		ActorType: "account", ActorID: account.ID, ResourceType: "invitation",
		RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	})
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "invitation_not_found", "The invitation was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, invitationResponse(invitation))
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
	if input.AllowedOrigins == nil {
		input.AllowedOrigins = []string{}
	}
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

func invitationResponse(invitation store.OrganizationInvitation) map[string]any {
	return map[string]any{
		"id": invitation.ID,
		"organization": map[string]any{
			"id": invitation.OrganizationID, "name": invitation.OrganizationName,
		},
		"email": invitation.Email, "role": invitation.Role,
		"invited_by": invitation.InvitedByEmail, "status": invitation.Status,
		"expires_at": invitation.ExpiresAt, "created_at": invitation.CreatedAt,
	}
}

func (s *Server) handleDevConfirmations(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Env != "dev" || s.devOutbox == nil {
		writeError(w, r, http.StatusNotFound, "not_found", "The resource was not found.")
		return
	}
	now := time.Now()
	entries := s.devOutbox.list(devMailboxLimit)
	invitationEntries := s.devOutbox.listInvitations(devMailboxLimit)
	confirmations := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		confirmations = append(confirmations, map[string]any{
			"email": entry.Email, "subdomain": entry.Subdomain,
			"confirm_url": entry.ConfirmURL, "created_at": entry.CreatedAt,
			"used": entry.Used, "expired": !entry.Used && !entry.ExpiresAt.After(now),
		})
	}
	w.Header().Set("Cache-Control", "no-store")
	invitations := make([]map[string]any, 0, len(invitationEntries))
	for _, entry := range invitationEntries {
		invitations = append(invitations, map[string]any{
			"invitation_id": entry.InvitationID, "organization_id": entry.OrganizationID,
			"organization_name": entry.OrganizationName, "email": entry.Email,
			"invited_by": entry.InvitedByEmail, "account_url": entry.AccountURL,
			"created_at": entry.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"confirmations": confirmations, "invitations": invitations})
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
		return "", errors.New("CONFIRM_URL_BASE is required for confirmations")
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

func invitationURL(confirmBase, invitationID string) (string, error) {
	parsed, err := url.Parse(confirmBase)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("CONFIRM_URL_BASE must be an absolute URL")
	}
	parsed.Path = "/account/"
	parsed.RawQuery = url.Values{"invitation": []string{invitationID}}.Encode()
	parsed.Fragment = ""
	return parsed.String(), nil
}
