package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/archura/core/internal/store"
)

const (
	maxManifestUses      = 100
	maxComponentPathSize = 128
)

type deployCheckRequest struct {
	TopLevel string   `json:"top_level"`
	Uses     []string `json:"uses"`
}

func (s *Server) paidComponentAccess(
	ctx context.Context,
	organization store.Organization,
) (bool, error) {
	billing, err := s.store.BillingForOrganization(ctx, organization.ID)
	if err != nil {
		return false, err
	}
	return store.HasPaidComponentAccess(billing, organization.CapsExempt, s.now().UTC()), nil
}

func (s *Server) requirePaidComponentAccess(
	w http.ResponseWriter,
	r *http.Request,
	organization store.Organization,
) bool {
	allowed, err := s.paidComponentAccess(r.Context(), organization)
	if err != nil {
		s.internalError(w, r, err)
		return false
	}
	if !allowed {
		writeComponentRequiresPaid(w, r)
		return false
	}
	return true
}

func writeComponentRequiresPaid(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, http.StatusPaymentRequired, "component_requires_paid", "This component needs the Basic plan.")
}

func validDeployManifest(input deployCheckRequest) bool {
	if !componentPathIsWellFormed(input.TopLevel, maxComponentPathSize) || len(input.Uses) > maxManifestUses {
		return false
	}
	for _, path := range input.Uses {
		if !componentPathIsWellFormed(path, maxComponentPathSize) {
			return false
		}
	}
	return true
}

func manifestNeedsPaidAccess(input deployCheckRequest) (bool, bool) {
	topLevel, known := classifyComponentPath(input.TopLevel)
	if !known {
		return false, false
	}
	needsPaid := topLevel.Kind == componentKindComponent || topLevel.Capability == componentCapabilityBackend
	for _, path := range input.Uses {
		policy, known := classifyComponentPath(path)
		if !known {
			return false, false
		}
		if policy.Capability == componentCapabilityBackend {
			needsPaid = true
		}
	}
	return needsPaid, true
}

func (s *Server) handleDeployCheck(w http.ResponseWriter, r *http.Request) {
	if !s.authenticateInternal(r) {
		s.securityEvent(r, "invalid_internal_key")
		writeError(w, r, http.StatusUnauthorized, "invalid_internal_key", "The internal credential is invalid.")
		return
	}
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return
	}
	var input deployCheckRequest
	if err := decodeJSON(w, r, &input); err != nil || !validDeployManifest(input) {
		writeError(w, r, http.StatusUnprocessableEntity, "invalid_component_manifest", "The component manifest is invalid.")
		return
	}

	organization, err := s.store.OrganizationByID(r.Context(), chi.URLParam(r, "organizationID"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "organization_not_found", "The organization was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}

	needsPaid, known := manifestNeedsPaidAccess(input)
	if !known {
		writeComponentRequiresPaid(w, r)
		return
	}
	if needsPaid {
		allowed, err := s.paidComponentAccess(r.Context(), organization)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		if !allowed {
			writeComponentRequiresPaid(w, r)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"allowed": true})
}
