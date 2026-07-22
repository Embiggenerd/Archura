package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/archura/core/internal/store"
	"github.com/archura/core/internal/totp"
)

const mfaIssuer = "Archura Ops"

// handleAdminMFAEnroll issues a fresh TOTP secret for the owner to add to an
// authenticator app. Enrollment isn't complete until a code is confirmed via
// activate. Re-enrolling before activation is allowed; re-enrolling an already
// active account is refused so a lost device is handled deliberately, not by a
// silent secret swap.
func (s *Server) handleAdminMFAEnroll(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	info := adminSession(r)
	if info.MFAActivated {
		writeError(w, r, http.StatusConflict, "mfa_already_enrolled", "Two-factor authentication is already active for this account.")
		return
	}
	secret, err := totp.GenerateSecret()
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	if err := repository.SetAccountMFASecret(r.Context(), info.Account.ID, secret, s.adminAudit(r)); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"secret":      secret,
		"otpauth_uri": totp.ProvisioningURI(secret, info.Account.Email, mfaIssuer),
	})
}

// handleAdminMFAActivate confirms enrollment with the first valid code, then
// elevates the current session so the owner can proceed without a second prompt.
func (s *Server) handleAdminMFAActivate(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	info := adminSession(r)
	var input struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	if info.MFASecret == "" || info.MFAActivated {
		writeError(w, r, http.StatusConflict, "mfa_not_enrolling", "Start enrollment before activating.")
		return
	}
	if !totp.Validate(info.MFASecret, input.Code, time.Now()) {
		s.recordMFARejection(r, info.Account.ID)
		writeError(w, r, http.StatusUnauthorized, "mfa_code_invalid", "That code is incorrect or expired.")
		return
	}
	if err := repository.ActivateAccountMFA(r.Context(), info.Account.ID, s.adminAudit(r)); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeError(w, r, http.StatusConflict, "mfa_not_enrolling", "Start enrollment before activating.")
			return
		}
		s.internalError(w, r, err)
		return
	}
	s.elevateAndRespond(w, r, repository, info.Account.ID)
}

// handleAdminMFAVerify performs a step-up: a valid code re-elevates the session
// for the elevation window.
func (s *Server) handleAdminMFAVerify(w http.ResponseWriter, r *http.Request) {
	repository, ok := s.adminRepository(w, r)
	if !ok {
		return
	}
	info := adminSession(r)
	var input struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(w, r, &input); err != nil {
		return
	}
	if !info.MFAActivated {
		writeError(w, r, http.StatusForbidden, "mfa_enrollment_required", "Enroll in two-factor authentication first.")
		return
	}
	if !totp.Validate(info.MFASecret, input.Code, time.Now()) {
		s.recordMFARejection(r, info.Account.ID)
		writeError(w, r, http.StatusUnauthorized, "mfa_code_invalid", "That code is incorrect or expired.")
		return
	}
	s.elevateAndRespond(w, r, repository, info.Account.ID)
}

func (s *Server) elevateAndRespond(w http.ResponseWriter, r *http.Request, repository adminRepository, accountID string) {
	until := time.Now().Add(adminElevationWindow)
	audit := s.adminAudit(r)
	audit.ActorType = "account"
	audit.ActorID = accountID
	audit.ResourceID = accountID
	if err := repository.ElevateAdminSession(r.Context(), adminSessionHash(r), until, audit); err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"elevated_until": until.UTC()})
}

func (s *Server) recordMFARejection(r *http.Request, accountID string) {
	s.auditRejectedEvent(r, store.AuditEvent{
		ActorType: "account", ActorID: accountID, Action: "admin.mfa_rejected",
		ResourceType: "account", ResourceID: accountID, Outcome: "rejected",
		RequestID: middleware.GetReqID(r.Context()), Metadata: store.EmptyAuditMetadata{},
	})
}

func (s *Server) adminAudit(r *http.Request) store.AuditEvent {
	return store.AuditEvent{RequestID: middleware.GetReqID(r.Context())}
}
