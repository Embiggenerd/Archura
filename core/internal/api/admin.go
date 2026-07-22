package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/store"
)

type adminRepository interface {
	AdminOrganizations(context.Context, string, int, int) (store.AdminPage[store.AdminOrganization], error)
	AdminOrganizationByID(context.Context, string) (store.AdminOrganization, error)
	AdminOrganizationMembers(context.Context, string, int, int) (store.AdminPage[store.AdminOrganizationMember], error)
	AdminOrganizationDesigns(context.Context, string, int, int) (store.AdminPage[store.Design], error)
	AdminDesignByID(context.Context, string) (store.Design, error)
	AdminForks(context.Context, string, int, int) (store.AdminPage[store.Design], error)
	CreateFork(context.Context, string, string, string, store.AuditEvent) (store.Design, error)
	FinalizeFork(context.Context, string, store.ForkFinalize, store.AuditEvent) (store.Design, error)
	DefaultFreePlan(context.Context) (store.DefaultFreePlan, error)
	UpdateDefaultFreePlan(context.Context, store.FreePlanPatch, store.AuditEvent) (store.DefaultFreePlan, error)
	UpdateOrganizationFreePlan(context.Context, string, store.OrganizationFreePlanPatch, store.AuditEvent) (store.OrganizationBilling, error)
	AdminSessionByTokenHash(context.Context, string) (store.AdminSessionInfo, error)
	SetAccountMFASecret(context.Context, string, string, store.AuditEvent) error
	ActivateAccountMFA(context.Context, string, store.AuditEvent) error
	ElevateAdminSession(context.Context, string, time.Time, store.AuditEvent) error
}

type adminAccountContextKey struct{}
type adminSessionContextKey struct{}
type adminSessionHashContextKey struct{}

// How long a step-up MFA verification keeps an admin session elevated.
const adminElevationWindow = 15 * time.Minute

func (s *Server) requireAdminAPIEnabled(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.cfg.AdminAPIEnabled {
			writeError(w, r, http.StatusNotFound, "not_found", "The requested resource was not found.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requirePlatformOwner authenticates the session, requires the platform_owner
// staff role, and loads MFA/elevation state onto the context. It does NOT
// enforce step-up — that is requireAdminElevation, layered on the sensitive
// routes so enrollment/verification stay reachable.
func (s *Server) requirePlatformOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info, hash, ok := s.adminSessionInfo(w, r)
		if !ok {
			return
		}
		if info.Account.StaffRole != "platform_owner" {
			writeError(w, r, http.StatusForbidden, "platform_owner_required", "A platform owner account is required.")
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		ctx := context.WithValue(r.Context(), adminAccountContextKey{}, info.Account)
		ctx = context.WithValue(ctx, adminSessionContextKey{}, info)
		ctx = context.WithValue(ctx, adminSessionHashContextKey{}, hash)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// requireAdminElevation gates sensitive admin actions on step-up MFA in prod: the
// owner must be enrolled and have verified a TOTP code within the elevation
// window. In dev it is a pass-through so the console stays frictionless locally.
func (s *Server) requireAdminElevation(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.Env != "prod" {
			next.ServeHTTP(w, r)
			return
		}
		info := adminSession(r)
		if !info.MFAActivated {
			writeError(w, r, http.StatusForbidden, "mfa_enrollment_required", "Enroll in two-factor authentication to use the platform console.")
			return
		}
		if info.ElevatedUntil == nil || !info.ElevatedUntil.After(time.Now()) {
			writeError(w, r, http.StatusForbidden, "mfa_required", "Verify your two-factor code to continue.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// adminSessionInfo resolves the bearer session to its account + MFA state.
func (s *Server) adminSessionInfo(w http.ResponseWriter, r *http.Request) (store.AdminSessionInfo, string, bool) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return store.AdminSessionInfo{}, "", false
	}
	token, ok := bearerToken(r)
	if !ok || !archauth.HasKindForEnv(token, "sess", s.cfg.Env) {
		s.securityEvent(r, "invalid_account_session")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The account session is invalid.")
		return store.AdminSessionInfo{}, "", false
	}
	hash := archauth.Hash(token)
	info, err := repository.AdminSessionByTokenHash(r.Context(), hash)
	if errors.Is(err, store.ErrNotFound) {
		s.securityEvent(r, "invalid_account_session")
		writeError(w, r, http.StatusUnauthorized, "invalid_token", "The account session is invalid.")
		return store.AdminSessionInfo{}, "", false
	}
	if err != nil {
		s.internalError(w, r, err)
		return store.AdminSessionInfo{}, "", false
	}
	return info, hash, true
}

func adminAccount(r *http.Request) store.Account {
	account, _ := r.Context().Value(adminAccountContextKey{}).(store.Account)
	return account
}

func adminSession(r *http.Request) store.AdminSessionInfo {
	info, _ := r.Context().Value(adminSessionContextKey{}).(store.AdminSessionInfo)
	return info
}

func adminSessionHash(r *http.Request) string {
	hash, _ := r.Context().Value(adminSessionHashContextKey{}).(string)
	return hash
}

func (s *Server) adminRepository(w http.ResponseWriter, r *http.Request) (adminRepository, bool) {
	repository, ok := s.store.(adminRepository)
	if !ok {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The admin database is unavailable.")
		return nil, false
	}
	return repository, true
}

func (s *Server) handleAdminContext(w http.ResponseWriter, r *http.Request) {
	info := adminSession(r)
	elevated := info.ElevatedUntil != nil && info.ElevatedUntil.After(time.Now())
	writeJSON(w, http.StatusOK, map[string]any{
		"env": s.cfg.Env,
		// The console uses these to know whether to prompt for enrollment or a
		// step-up code. In dev, step-up is not enforced so it reads as satisfied.
		"mfa_required": s.cfg.Env == "prod",
		"mfa_enrolled": info.MFAActivated,
		"mfa_elevated": elevated || s.cfg.Env != "prod",
	})
}

func adminPagination(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	limit := 25
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, r, http.StatusUnprocessableEntity, "invalid_pagination", "The limit must be between 1 and 100.")
			return 0, 0, false
		}
		limit = parsed
	}
	offset := 0
	if value := r.URL.Query().Get("cursor"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 {
			writeError(w, r, http.StatusUnprocessableEntity, "invalid_pagination", "The cursor is invalid.")
			return 0, 0, false
		}
		offset = parsed
	}
	return limit, offset, true
}

func (s *Server) handleAdminOrganizations(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	limit, offset, ok := adminPagination(w, r)
	if !ok {
		return
	}
	page, err := repository.AdminOrganizations(r.Context(), r.URL.Query().Get("q"), limit, offset)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(page.Items))
	for _, organization := range page.Items {
		items = append(items, adminOrganizationResponse(organization))
	}
	writeJSON(w, http.StatusOK, map[string]any{"organizations": items, "next_cursor": nullableCursor(page.NextCursor)})
}

func (s *Server) handleAdminOrganization(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	organizationID := chi.URLParam(r, "organizationID")
	organization, err := repository.AdminOrganizationByID(r.Context(), organizationID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	members, err := repository.AdminOrganizationMembers(r.Context(), organizationID, 5, 0)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	designs, err := repository.AdminOrganizationDesigns(r.Context(), organizationID, 5, 0)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	memberViews := make([]map[string]any, 0, len(members.Items))
	for _, member := range members.Items {
		memberViews = append(memberViews, adminMemberResponse(member))
	}
	designViews := make([]map[string]any, 0, len(designs.Items))
	for _, design := range designs.Items {
		designViews = append(designViews, adminDesignResponse(design))
	}
	response := adminOrganizationResponse(organization)
	response["member_summary"] = memberViews
	response["design_summary"] = designViews
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleAdminOrganizationMembers(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	limit, offset, ok := adminPagination(w, r)
	if !ok {
		return
	}
	page, err := repository.AdminOrganizationMembers(r.Context(), chi.URLParam(r, "organizationID"), limit, offset)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	items := make([]map[string]any, 0, len(page.Items))
	for _, member := range page.Items {
		items = append(items, adminMemberResponse(member))
	}
	writeJSON(w, http.StatusOK, map[string]any{"members": items, "next_cursor": nullableCursor(page.NextCursor)})
}

func (s *Server) handleAdminOrganizationDesigns(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	limit, offset, ok := adminPagination(w, r)
	if !ok {
		return
	}
	page, err := repository.AdminOrganizationDesigns(r.Context(), chi.URLParam(r, "organizationID"), limit, offset)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, adminDesignPageResponse(page))
}

func (s *Server) handleAdminDesign(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	design, err := repository.AdminDesignByID(r.Context(), chi.URLParam(r, "designID"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "design_not_found", "The design was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, adminDesignResponse(design))
}

type createForkRequest struct {
	SourceDesignID string `json:"source_design_id"`
	IdempotencyKey string `json:"idempotency_key"`
}

func (s *Server) handleAdminCreateFork(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	var input createForkRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	input.SourceDesignID = strings.TrimSpace(input.SourceDesignID)
	input.IdempotencyKey = strings.TrimSpace(input.IdempotencyKey)
	if input.SourceDesignID == "" || len(input.IdempotencyKey) < 1 || len(input.IdempotencyKey) > 128 {
		writeError(w, r, http.StatusUnprocessableEntity, "invalid_fork", "The source design and idempotency key are required.")
		return
	}
	account := adminAccount(r)
	fork, err := repository.CreateFork(r.Context(), input.SourceDesignID, input.IdempotencyKey, account.ID, adminAudit(r, account))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "design_not_found", "The source design or platform workspace was not found.")
		return
	}
	if errors.Is(err, store.ErrConflict) {
		writeError(w, r, http.StatusConflict, "idempotency_conflict", "The idempotency key belongs to a different source design.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, adminDesignResponse(fork))
}

type finalizeForkRequest struct {
	Status             string `json:"status"`
	SourceArtifactKind string `json:"source_artifact_kind"`
	SourceETag         string `json:"source_etag"`
	TemplateRef        string `json:"template_ref"`
}

func (s *Server) handleAdminFinalizeFork(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	var input finalizeForkRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	input.Status = strings.TrimSpace(input.Status)
	input.SourceArtifactKind = strings.TrimSpace(input.SourceArtifactKind)
	input.SourceETag = strings.TrimSpace(input.SourceETag)
	input.TemplateRef = strings.TrimSpace(input.TemplateRef)
	if !validFinalize(input) {
		writeError(w, r, http.StatusUnprocessableEntity, "invalid_finalize", "The fork status and provenance are invalid.")
		return
	}
	account := adminAccount(r)
	fork, err := repository.FinalizeFork(r.Context(), chi.URLParam(r, "forkID"), store.ForkFinalize{
		Status: input.Status, SourceArtifactKind: input.SourceArtifactKind,
		SourceETag: input.SourceETag, TemplateRef: input.TemplateRef,
	}, adminAudit(r, account))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "fork_not_found", "The fork was not found.")
		return
	}
	if errors.Is(err, store.ErrInvalidState) || errors.Is(err, store.ErrConflict) {
		writeError(w, r, http.StatusConflict, "fork_state_conflict", "The fork is already in a conflicting state.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, adminDesignResponse(fork))
}

func validFinalize(input finalizeForkRequest) bool {
	if input.Status != "ready" && input.Status != "failed" {
		return false
	}
	if input.SourceArtifactKind == "" {
		return input.Status == "failed" && input.SourceETag == "" && input.TemplateRef == ""
	}
	switch input.SourceArtifactKind {
	case "published", "draft":
		return input.SourceETag != "" && input.TemplateRef == ""
	case "template":
		return input.SourceETag == "" && input.TemplateRef != ""
	default:
		return false
	}
}

func (s *Server) handleAdminForks(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state == "" {
		state = "ready"
	}
	if state != "ready" && state != "pending" && state != "failed" {
		writeError(w, r, http.StatusUnprocessableEntity, "invalid_fork_state", "The fork state is invalid.")
		return
	}
	limit, offset, ok := adminPagination(w, r)
	if !ok {
		return
	}
	page, err := repository.AdminForks(r.Context(), state, limit, offset)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, adminForkPageResponse(page))
}

func (s *Server) handleAdminDefaultPlan(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	plan, err := repository.DefaultFreePlan(r.Context())
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

type defaultPlanPatchRequest struct {
	TrialDays       json.RawMessage `json:"trial_days"`
	FreeDesignLimit json.RawMessage `json:"free_design_limit"`
	FreeSiteLimit   json.RawMessage `json:"free_site_limit"`
	FreeNoExpiry    json.RawMessage `json:"free_no_expiry"`
}

func (s *Server) handleAdminPatchDefaultPlan(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	var input defaultPlanPatchRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	patch, valid := parseDefaultPlanPatch(input)
	if !valid {
		writeError(w, r, http.StatusUnprocessableEntity, "invalid_free_plan", "Free-plan values must be non-null and non-negative.")
		return
	}
	account := adminAccount(r)
	plan, err := repository.UpdateDefaultFreePlan(r.Context(), patch, adminAudit(r, account))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, plan)
}

type organizationPlanPatchRequest struct {
	FreeTrialDays   json.RawMessage `json:"free_trial_days"`
	TrialEndsAt     json.RawMessage `json:"trial_ends_at"`
	FreeDesignLimit json.RawMessage `json:"free_design_limit"`
	FreeSiteLimit   json.RawMessage `json:"free_site_limit"`
	FreeNoExpiry    json.RawMessage `json:"free_no_expiry"`
	Reason          string          `json:"reason"`
}

func (s *Server) handleAdminPatchOrganizationPlan(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	var input organizationPlanPatchRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	organizationID := chi.URLParam(r, "organizationID")
	organization, err := repository.AdminOrganizationByID(r.Context(), organizationID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	patch, valid := parseOrganizationPlanPatch(input, organization.Billing)
	if !valid {
		writeError(w, r, http.StatusUnprocessableEntity, "invalid_free_plan", "The free-plan values do not match the organization's trial stage.")
		return
	}
	account := adminAccount(r)
	billing, err := repository.UpdateOrganizationFreePlan(r.Context(), organizationID, patch, adminAudit(r, account))
	if errors.Is(err, store.ErrConflict) {
		writeError(w, r, http.StatusConflict, "workspace_invariant", "The platform workspace cannot be made expiring.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, adminBillingResponse(billing))
}

func parseDefaultPlanPatch(input defaultPlanPatchRequest) (store.FreePlanPatch, bool) {
	var patch store.FreePlanPatch
	valid := true
	patch.TrialDays, valid = rawNonNegativeInt(input.TrialDays, valid)
	patch.FreeDesignLimit, valid = rawNonNegativeInt(input.FreeDesignLimit, valid)
	patch.FreeSiteLimit, valid = rawNonNegativeInt(input.FreeSiteLimit, valid)
	patch.FreeNoExpiry, valid = rawBool(input.FreeNoExpiry, valid)
	return patch, valid && (patch.TrialDays != nil || patch.FreeDesignLimit != nil || patch.FreeSiteLimit != nil || patch.FreeNoExpiry != nil)
}

func parseOrganizationPlanPatch(input organizationPlanPatchRequest, billing store.OrganizationBilling) (store.OrganizationFreePlanPatch, bool) {
	patch := store.OrganizationFreePlanPatch{Reason: strings.TrimSpace(input.Reason)}
	valid := patch.Reason != ""
	patch.FreeTrialDays, valid = rawNonNegativeInt(input.FreeTrialDays, valid)
	patch.FreeDesignLimit, valid = rawNonNegativeInt(input.FreeDesignLimit, valid)
	patch.FreeSiteLimit, valid = rawNonNegativeInt(input.FreeSiteLimit, valid)
	patch.FreeNoExpiry, valid = rawBool(input.FreeNoExpiry, valid)
	if len(input.TrialEndsAt) > 0 {
		if string(input.TrialEndsAt) == "null" {
			valid = false
		} else {
			var value string
			if err := json.Unmarshal(input.TrialEndsAt, &value); err != nil {
				valid = false
			} else if parsed, err := time.Parse(time.RFC3339, value); err != nil {
				valid = false
			} else {
				_, offset := parsed.Zone()
				if offset != 0 {
					valid = false
				} else {
					parsed = parsed.UTC()
					patch.TrialEndsAt = &parsed
				}
			}
		}
	}
	if patch.FreeTrialDays != nil && patch.TrialEndsAt != nil {
		valid = false
	}
	if billing.TrialStartedAt == nil {
		if patch.TrialEndsAt != nil {
			valid = false
		}
	} else {
		if patch.FreeTrialDays != nil || (patch.TrialEndsAt != nil && !patch.TrialEndsAt.After(*billing.TrialStartedAt)) {
			valid = false
		}
	}
	changed := patch.FreeTrialDays != nil || patch.TrialEndsAt != nil || patch.FreeDesignLimit != nil ||
		patch.FreeSiteLimit != nil || patch.FreeNoExpiry != nil
	return patch, valid && changed
}

func rawNonNegativeInt(raw json.RawMessage, valid bool) (*int, bool) {
	if len(raw) == 0 {
		return nil, valid
	}
	if string(raw) == "null" {
		return nil, false
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil || value < 0 {
		return nil, false
	}
	return &value, valid
}

func rawBool(raw json.RawMessage, valid bool) (*bool, bool) {
	if len(raw) == 0 {
		return nil, valid
	}
	if string(raw) == "null" {
		return nil, false
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, false
	}
	return &value, valid
}

func adminAudit(r *http.Request, account store.Account) store.AuditEvent {
	return store.AuditEvent{
		ActorType: "account", ActorID: account.ID,
		RequestID: middleware.GetReqID(r.Context()),
	}
}

func adminOrganizationResponse(organization store.AdminOrganization) map[string]any {
	return map[string]any{
		"id": organization.ID, "name": organization.Name, "slug": organization.Slug,
		"status": organization.Status, "allowed_origins": organization.AllowedOrigins,
		"caps_exempt": organization.CapsExempt, "is_platform_workspace": organization.IsPlatformWorkspace,
		"member_count": organization.MemberCount, "design_count": organization.DesignCount,
		"site_count": organization.SiteCount, "billing": adminBillingResponse(organization.Billing),
		"created_at": organization.CreatedAt,
	}
}

func adminBillingResponse(billing store.OrganizationBilling) map[string]any {
	return map[string]any{
		"trial_started_at": billing.TrialStartedAt, "trial_ends_at": billing.TrialEndsAt,
		"serve_grace_ends_at": billing.ServeGraceEndsAt, "free_trial_days": billing.FreeTrialDays,
		"free_design_limit": billing.FreeDesignLimit, "free_site_limit": billing.FreeSiteLimit,
		"free_no_expiry": billing.FreeNoExpiry, "stripe_customer_id": billing.StripeCustomerID,
		"stripe_subscription_id":     billing.StripeSubscriptionID,
		"stripe_subscription_status": billing.StripeSubscriptionStatus,
		"current_period_end":         billing.CurrentPeriodEnd, "cancel_at_period_end": billing.CancelAtPeriodEnd,
		"updated_at": billing.UpdatedAt,
	}
}

func adminMemberResponse(member store.AdminOrganizationMember) map[string]any {
	return map[string]any{
		"account_id": member.AccountID, "email": member.Email,
		"role": member.Role, "created_at": member.CreatedAt,
	}
}

func adminDesignResponse(design store.Design) map[string]any {
	response := designResponse(design)
	if design.ForkIdempotencyKey != "" {
		response["fork_status"] = design.ForkStatus
		response["forked_from"] = design.ForkedFrom
		response["source_org_id"] = design.SourceOrganizationID
		response["forked_by"] = design.ForkedBy
		response["forked_at"] = design.ForkedAt
		response["source_artifact_kind"] = emptyAsNil(design.SourceArtifactKind)
		response["source_etag"] = emptyAsNil(design.SourceArtifactETag)
		response["template_ref"] = emptyAsNil(design.TemplateRef)
	}
	return response
}

func adminDesignPageResponse(page store.AdminPage[store.Design]) map[string]any {
	items := make([]map[string]any, 0, len(page.Items))
	for _, design := range page.Items {
		items = append(items, adminDesignResponse(design))
	}
	return map[string]any{"designs": items, "next_cursor": nullableCursor(page.NextCursor)}
}

func adminForkPageResponse(page store.AdminPage[store.Design]) map[string]any {
	response := adminDesignPageResponse(page)
	response["forks"] = response["designs"]
	delete(response, "designs")
	return response
}

func nullableCursor(cursor string) any {
	if cursor == "" {
		return nil
	}
	return cursor
}

func emptyAsNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}
