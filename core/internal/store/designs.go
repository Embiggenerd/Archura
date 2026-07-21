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
	ID                   string
	OrganizationID       string
	Name                 string
	ComponentPath        string
	ForkedFrom           string
	SourceOrganizationID string
	ForkedBy             string
	ForkedAt             *time.Time
	SourceArtifactKind   string
	SourceArtifactETag   string
	TemplateRef          string
	ForkIdempotencyKey   string
	ForkStatus           string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// CreateDesign inserts a design only if the organization is below its plan's
// design limit. The organization-row lock serializes the count and insert, so
// the cap holds under concurrent creates. Returns ErrLimitReached when met.
func (s *Store) CreateDesign(
	ctx context.Context,
	organizationID, name, componentPath string,
	audit AuditEvent,
) (Design, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Design{}, fmt.Errorf("begin create design: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	limit, exempt, err := effectiveResourceLimitsTx(ctx, tx, organizationID, time.Now().UTC())
	if err != nil {
		return Design{}, err
	}
	var design Design
	query := `
		INSERT INTO designs (organization_id, name, component_path)
		SELECT $1::uuid, $2, $3
		WHERE $4 OR (
			SELECT count(*) FROM designs
			WHERE organization_id = $1::uuid AND deleted_at IS NULL
		) < $5
		RETURNING id, organization_id::text, name, component_path, created_at, updated_at`
	err = tx.QueryRow(ctx, query,
		organizationID, name, componentPath, exempt, limit.Designs,
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

type resourceLimits struct {
	Designs int
	Sites   int
}

func effectiveResourceLimitsTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	now time.Time,
) (resourceLimits, bool, error) {
	var exempt bool
	if err := tx.QueryRow(ctx, `
		SELECT caps_exempt
		FROM organizations
		WHERE id = $1::uuid
		FOR UPDATE`, organizationID).Scan(&exempt); err != nil {
		return resourceLimits{}, false, mapStoreError("lock organization limits", err)
	}
	if exempt {
		return resourceLimits{}, true, nil
	}
	billing, err := billingForOrganizationTx(ctx, tx, organizationID, false)
	if err != nil {
		return resourceLimits{}, false, err
	}
	entitlement := OrganizationEntitlementFor(billing, "", now)
	if !entitlement.CanEdit {
		return resourceLimits{}, false, ErrReadOnly
	}
	paid := billing.StripeSubscriptionStatus == "active" || billing.StripeSubscriptionStatus == "trialing" ||
		(billing.StripeSubscriptionStatus == "canceled" && billing.CurrentPeriodEnd != nil && now.Before(*billing.CurrentPeriodEnd))
	if paid {
		return resourceLimits{Designs: 10, Sites: 3}, false, nil
	}
	return resourceLimits{Designs: billing.FreeDesignLimit, Sites: billing.FreeSiteLimit}, false, nil
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
