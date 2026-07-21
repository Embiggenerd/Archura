package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/archura/core/internal/store"
)

type createDesignRequest struct {
	Name          string `json:"name"`
	ComponentPath string `json:"component_path"`
}

func (s *Server) handleCreateDesign(w http.ResponseWriter, r *http.Request) {
	account, organization, ok := s.accountOrganization(w, r, false)
	if !ok {
		return
	}
	var input createDesignRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, r, http.StatusBadRequest, "invalid_request", "The request body is invalid.")
		return
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Untitled design"
	}
	if len(name) > 80 {
		name = name[:80]
	}
	componentPath := strings.TrimSpace(input.ComponentPath)
	if !validComponentPath(componentPath) {
		componentPath = "pages/Landing"
	}

	design, err := s.store.CreateDesign(r.Context(), organization.ID, name, componentPath, store.AuditEvent{
		ActorType: "account", ActorID: account.ID, RequestID: middleware.GetReqID(r.Context()),
		Metadata: store.EmptyAuditMetadata{},
	})
	if errors.Is(err, store.ErrLimitReached) {
		writeError(w, r, http.StatusConflict, "design_limit_reached", "This plan's design limit is reached. Upgrade to add more.")
		return
	}
	if errors.Is(err, store.ErrReadOnly) {
		writeError(w, r, http.StatusForbidden, "organization_read_only", "This organization is read-only.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, designResponse(design))
}

func (s *Server) handleListDesigns(w http.ResponseWriter, r *http.Request) {
	_, organization, ok := s.accountOrganization(w, r, false)
	if !ok {
		return
	}
	designs, err := s.store.DesignsForOrganization(r.Context(), organization.ID)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	views := make([]map[string]any, 0, len(designs))
	for _, design := range designs {
		views = append(views, designResponse(design))
	}
	writeJSON(w, http.StatusOK, map[string]any{"organization_id": organization.ID, "designs": views})
}

func (s *Server) handleGetDesign(w http.ResponseWriter, r *http.Request) {
	_, organization, ok := s.accountOrganization(w, r, false)
	if !ok {
		return
	}
	design, err := s.store.DesignForOrganization(r.Context(), organization.ID, chi.URLParam(r, "designID"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, r, http.StatusNotFound, "design_not_found", "The design was not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, designResponse(design))
}

func validComponentPath(value string) bool {
	if value == "" {
		return false
	}
	for _, segment := range strings.Split(value, "/") {
		if segment == "" || segment == ".." {
			return false
		}
	}
	return true
}

func designResponse(design store.Design) map[string]any {
	return map[string]any{
		"id":              design.ID,
		"organization_id": design.OrganizationID,
		"name":            design.Name,
		"component_path":  design.ComponentPath,
		"created_at":      design.CreatedAt,
		"updated_at":      design.UpdatedAt,
	}
}
