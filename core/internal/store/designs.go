package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Design is the authoritative record of a top-level embeddable artifact owned
// by an organization. The content itself (the canonical artifact + embed
// modules) lives in R2; this row is identity + metadata and the basis for the
// per-organization design cap.
type Design struct {
	ID             string
	OrganizationID string
	Name           string
	ComponentPath  string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// CreateDesign inserts a design only if the organization is below its plan's
// design limit. The count and insert are one statement, so the cap holds under
// concurrent creates. Returns ErrLimitReached when the cap is met.
func (s *Store) CreateDesign(
	ctx context.Context,
	organizationID, name, componentPath string,
	limit int,
	audit AuditEvent,
) (Design, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Design{}, fmt.Errorf("begin create design: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var design Design
	err = tx.QueryRow(ctx, `
		INSERT INTO designs (organization_id, name, component_path)
		SELECT $1::uuid, $2, $3
		WHERE (
			SELECT count(*) FROM designs
			WHERE organization_id = $1::uuid AND deleted_at IS NULL
		) < $4
		RETURNING id, organization_id::text, name, component_path, created_at, updated_at`,
		organizationID, name, componentPath, limit,
	).Scan(&design.ID, &design.OrganizationID, &design.Name, &design.ComponentPath,
		&design.CreatedAt, &design.UpdatedAt)
	if err == pgx.ErrNoRows {
		return Design{}, ErrLimitReached
	}
	if err != nil {
		return Design{}, mapStoreError("create design", err)
	}

	audit.OrganizationID = organizationID
	audit.Action = "design.created"
	audit.ResourceType = "design"
	audit.ResourceID = design.ID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return Design{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Design{}, fmt.Errorf("commit create design: %w", err)
	}
	return design, nil
}

func (s *Store) DesignsForOrganization(ctx context.Context, organizationID string) ([]Design, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, organization_id::text, name, component_path, created_at, updated_at
		FROM designs
		WHERE organization_id = $1::uuid AND deleted_at IS NULL
		ORDER BY updated_at DESC`, organizationID)
	if err != nil {
		return nil, fmt.Errorf("list designs: %w", err)
	}
	defer rows.Close()
	designs := make([]Design, 0)
	for rows.Next() {
		var d Design
		if err := rows.Scan(&d.ID, &d.OrganizationID, &d.Name, &d.ComponentPath, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan design: %w", err)
		}
		designs = append(designs, d)
	}
	return designs, rows.Err()
}

// DesignForOrganization fetches one design scoped to its owning organization;
// ErrNotFound if it does not exist or belongs to another organization.
func (s *Store) DesignForOrganization(ctx context.Context, organizationID, designID string) (Design, error) {
	var d Design
	err := s.Pool.QueryRow(ctx, `
		SELECT id, organization_id::text, name, component_path, created_at, updated_at
		FROM designs
		WHERE id = $1 AND organization_id = $2::uuid AND deleted_at IS NULL`,
		designID, organizationID,
	).Scan(&d.ID, &d.OrganizationID, &d.Name, &d.ComponentPath, &d.CreatedAt, &d.UpdatedAt)
	if err == pgx.ErrNoRows {
		return Design{}, ErrNotFound
	}
	if err != nil {
		return Design{}, mapStoreError("find design", err)
	}
	return d, nil
}
