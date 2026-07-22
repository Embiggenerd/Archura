package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (s *Server) handleOrganizationExists(w http.ResponseWriter, r *http.Request) {
	if !s.authenticateInternal(r) {
		s.securityEvent(r, "invalid_internal_key")
		writeError(w, r, http.StatusUnauthorized, "invalid_internal_key", "The internal credential is invalid.")
		return
	}
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return
	}
	exists, err := s.store.OrganizationExists(r.Context(), chi.URLParam(r, "organizationID"))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"exists": exists})
}

func (s *Server) handleSiteBinding(w http.ResponseWriter, r *http.Request) {
	if !s.authenticateInternal(r) {
		s.securityEvent(r, "invalid_internal_key")
		writeError(w, r, http.StatusUnauthorized, "invalid_internal_key", "The internal credential is invalid.")
		return
	}
	if s.store == nil {
		writeError(w, r, http.StatusServiceUnavailable, "database_unavailable", "The database is unavailable.")
		return
	}
	organizationID, bound, err := s.store.SiteBinding(r.Context(), chi.URLParam(r, "subdomain"))
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	response := map[string]any{"bound": bound}
	if bound {
		response["organization_id"] = organizationID
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, response)
}
