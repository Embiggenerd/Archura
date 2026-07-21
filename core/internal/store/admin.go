package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

const PlatformWorkspaceSlug = "archura-platform-workspace"

func (s *Store) DefaultFreePlan(ctx context.Context) (DefaultFreePlan, error) {
	var plan DefaultFreePlan
	err := s.Pool.QueryRow(ctx, `
		SELECT trial_days, free_design_limit, free_site_limit, free_no_expiry, updated_at
		FROM default_free_plan
		WHERE singleton`).Scan(
		&plan.TrialDays, &plan.FreeDesignLimit, &plan.FreeSiteLimit, &plan.FreeNoExpiry, &plan.UpdatedAt,
	)
	if err != nil {
		return DefaultFreePlan{}, mapStoreError("get default free plan", err)
	}
	return plan, nil
}

func (s *Store) UpdateDefaultFreePlan(
	ctx context.Context,
	patch FreePlanPatch,
	audit AuditEvent,
) (DefaultFreePlan, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return DefaultFreePlan{}, fmt.Errorf("begin default plan update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	before, err := defaultFreePlanTx(ctx, tx, true)
	if err != nil {
		return DefaultFreePlan{}, err
	}
	after := before
	if patch.TrialDays != nil {
		after.TrialDays = *patch.TrialDays
	}
	if patch.FreeDesignLimit != nil {
		after.FreeDesignLimit = *patch.FreeDesignLimit
	}
	if patch.FreeSiteLimit != nil {
		after.FreeSiteLimit = *patch.FreeSiteLimit
	}
	if patch.FreeNoExpiry != nil {
		after.FreeNoExpiry = *patch.FreeNoExpiry
	}
	err = tx.QueryRow(ctx, `
		UPDATE default_free_plan
		SET trial_days = $1, free_design_limit = $2, free_site_limit = $3,
			free_no_expiry = $4, updated_at = now()
		WHERE singleton
		RETURNING trial_days, free_design_limit, free_site_limit, free_no_expiry, updated_at`,
		after.TrialDays, after.FreeDesignLimit, after.FreeSiteLimit, after.FreeNoExpiry,
	).Scan(&after.TrialDays, &after.FreeDesignLimit, &after.FreeSiteLimit, &after.FreeNoExpiry, &after.UpdatedAt)
	if err != nil {
		return DefaultFreePlan{}, mapStoreError("update default free plan", err)
	}
	audit.Action = "admin.default_plan_updated"
	audit.ResourceType = "free_plan"
	audit.ResourceID = "default"
	audit.Metadata = FreePlanAuditMetadata{Before: before, After: after}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return DefaultFreePlan{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DefaultFreePlan{}, fmt.Errorf("commit default plan update: %w", err)
	}
	return after, nil
}

func defaultFreePlanTx(ctx context.Context, tx pgx.Tx, lock bool) (DefaultFreePlan, error) {
	query := `
		SELECT trial_days, free_design_limit, free_site_limit, free_no_expiry, updated_at
		FROM default_free_plan
		WHERE singleton`
	if lock {
		query += ` FOR UPDATE`
	}
	var plan DefaultFreePlan
	if err := tx.QueryRow(ctx, query).Scan(
		&plan.TrialDays, &plan.FreeDesignLimit, &plan.FreeSiteLimit, &plan.FreeNoExpiry, &plan.UpdatedAt,
	); err != nil {
		return DefaultFreePlan{}, mapStoreError("get default free plan", err)
	}
	return plan, nil
}

func (s *Store) UpdateOrganizationFreePlan(
	ctx context.Context,
	organizationID string,
	patch OrganizationFreePlanPatch,
	audit AuditEvent,
) (OrganizationBilling, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return OrganizationBilling{}, fmt.Errorf("begin organization plan update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	before, err := billingForOrganizationTx(ctx, tx, organizationID, true)
	if err != nil {
		return OrganizationBilling{}, err
	}
	if patch.FreeNoExpiry != nil && !*patch.FreeNoExpiry {
		var workspace bool
		if err := tx.QueryRow(ctx, `
			SELECT is_platform_workspace FROM organizations WHERE id = $1::uuid`, organizationID,
		).Scan(&workspace); err != nil {
			return OrganizationBilling{}, mapStoreError("check platform workspace", err)
		}
		if workspace {
			return OrganizationBilling{}, ErrConflict
		}
	}
	after := before
	if patch.FreeTrialDays != nil {
		after.FreeTrialDays = *patch.FreeTrialDays
	}
	if patch.TrialEndsAt != nil {
		value := patch.TrialEndsAt.UTC()
		after.TrialEndsAt = &value
		after.ServeGraceEndsAt = &value
	}
	if patch.FreeDesignLimit != nil {
		after.FreeDesignLimit = *patch.FreeDesignLimit
	}
	if patch.FreeSiteLimit != nil {
		after.FreeSiteLimit = *patch.FreeSiteLimit
	}
	if patch.FreeNoExpiry != nil {
		after.FreeNoExpiry = *patch.FreeNoExpiry
	}
	err = tx.QueryRow(ctx, `
		UPDATE organization_billing
		SET free_trial_days = $2, trial_ends_at = $3, serve_grace_ends_at = $4,
			free_design_limit = $5, free_site_limit = $6, free_no_expiry = $7,
			updated_at = now()
		WHERE organization_id = $1::uuid
		RETURNING organization_id::text, trial_started_at, trial_ends_at, serve_grace_ends_at,
			free_trial_days, free_design_limit, free_site_limit, free_no_expiry,
			COALESCE(stripe_customer_id, ''), COALESCE(stripe_subscription_id, ''),
			COALESCE(stripe_subscription_status, ''), current_period_end,
			cancel_at_period_end, last_stripe_event_at, created_at, updated_at`,
		organizationID, after.FreeTrialDays, after.TrialEndsAt, after.ServeGraceEndsAt,
		after.FreeDesignLimit, after.FreeSiteLimit, after.FreeNoExpiry,
	).Scan(
		&after.OrganizationID, &after.TrialStartedAt, &after.TrialEndsAt, &after.ServeGraceEndsAt,
		&after.FreeTrialDays, &after.FreeDesignLimit, &after.FreeSiteLimit, &after.FreeNoExpiry,
		&after.StripeCustomerID, &after.StripeSubscriptionID, &after.StripeSubscriptionStatus,
		&after.CurrentPeriodEnd, &after.CancelAtPeriodEnd, &after.LastStripeEventAt,
		&after.CreatedAt, &after.UpdatedAt,
	)
	if err != nil {
		return OrganizationBilling{}, mapStoreError("update organization free plan", err)
	}
	audit.OrganizationID = organizationID
	audit.Action = "admin.organization_plan_updated"
	audit.ResourceType = "free_plan"
	audit.ResourceID = organizationID
	audit.Metadata = FreePlanAuditMetadata{
		Before: organizationFreePlanAudit(before),
		After:  organizationFreePlanAudit(after),
		Reason: patch.Reason,
	}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return OrganizationBilling{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OrganizationBilling{}, fmt.Errorf("commit organization plan update: %w", err)
	}
	return after, nil
}

func organizationFreePlanAudit(billing OrganizationBilling) map[string]any {
	return map[string]any{
		"free_trial_days":     billing.FreeTrialDays,
		"trial_started_at":    billing.TrialStartedAt,
		"trial_ends_at":       billing.TrialEndsAt,
		"serve_grace_ends_at": billing.ServeGraceEndsAt,
		"free_design_limit":   billing.FreeDesignLimit,
		"free_site_limit":     billing.FreeSiteLimit,
		"free_no_expiry":      billing.FreeNoExpiry,
	}
}

func billingForOrganizationTx(ctx context.Context, tx pgx.Tx, organizationID string, lock bool) (OrganizationBilling, error) {
	query := `
		SELECT organization_id::text, trial_started_at, trial_ends_at, serve_grace_ends_at,
			free_trial_days, free_design_limit, free_site_limit, free_no_expiry,
			COALESCE(stripe_customer_id, ''), COALESCE(stripe_subscription_id, ''),
			COALESCE(stripe_subscription_status, ''), current_period_end,
			cancel_at_period_end, last_stripe_event_at, created_at, updated_at
		FROM organization_billing
		WHERE organization_id = $1::uuid`
	if lock {
		query += ` FOR UPDATE`
	}
	var billing OrganizationBilling
	err := tx.QueryRow(ctx, query, organizationID).Scan(
		&billing.OrganizationID, &billing.TrialStartedAt, &billing.TrialEndsAt, &billing.ServeGraceEndsAt,
		&billing.FreeTrialDays, &billing.FreeDesignLimit, &billing.FreeSiteLimit, &billing.FreeNoExpiry,
		&billing.StripeCustomerID, &billing.StripeSubscriptionID, &billing.StripeSubscriptionStatus,
		&billing.CurrentPeriodEnd, &billing.CancelAtPeriodEnd, &billing.LastStripeEventAt,
		&billing.CreatedAt, &billing.UpdatedAt,
	)
	if err != nil {
		return OrganizationBilling{}, mapStoreError("get organization billing", err)
	}
	return billing, nil
}

func (s *Store) AdminOrganizations(ctx context.Context, query string, limit, offset int) (AdminPage[AdminOrganization], error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT o.id::text, o.name, o.slug, o.allowed_origins, o.status,
			o.caps_exempt, o.is_platform_workspace, o.created_at,
			(SELECT count(*) FROM organization_memberships m WHERE m.organization_id = o.id),
			(SELECT count(*) FROM designs d WHERE d.organization_id = o.id AND d.deleted_at IS NULL),
			(SELECT count(*) FROM organization_sites s WHERE s.organization_id = o.id),
			b.organization_id::text, b.trial_started_at, b.trial_ends_at, b.serve_grace_ends_at,
			b.free_trial_days, b.free_design_limit, b.free_site_limit, b.free_no_expiry,
			COALESCE(b.stripe_customer_id, ''), COALESCE(b.stripe_subscription_id, ''),
			COALESCE(b.stripe_subscription_status, ''), b.current_period_end,
			b.cancel_at_period_end, b.last_stripe_event_at, b.created_at, b.updated_at
		FROM organizations o
		JOIN organization_billing b ON b.organization_id = o.id
		WHERE $1 = '' OR o.id::text = $1 OR o.name ILIKE '%' || $1 || '%' OR o.slug ILIKE '%' || $1 || '%'
		ORDER BY o.created_at DESC, o.id
		LIMIT $2 OFFSET $3`, strings.TrimSpace(query), limit+1, offset)
	if err != nil {
		return AdminPage[AdminOrganization]{}, fmt.Errorf("list admin organizations: %w", err)
	}
	defer rows.Close()
	items := make([]AdminOrganization, 0, limit+1)
	for rows.Next() {
		var item AdminOrganization
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Slug, &item.AllowedOrigins, &item.Status,
			&item.CapsExempt, &item.IsPlatformWorkspace, &item.CreatedAt,
			&item.MemberCount, &item.DesignCount, &item.SiteCount,
			&item.Billing.OrganizationID, &item.Billing.TrialStartedAt, &item.Billing.TrialEndsAt,
			&item.Billing.ServeGraceEndsAt, &item.Billing.FreeTrialDays, &item.Billing.FreeDesignLimit,
			&item.Billing.FreeSiteLimit, &item.Billing.FreeNoExpiry, &item.Billing.StripeCustomerID,
			&item.Billing.StripeSubscriptionID, &item.Billing.StripeSubscriptionStatus,
			&item.Billing.CurrentPeriodEnd, &item.Billing.CancelAtPeriodEnd,
			&item.Billing.LastStripeEventAt, &item.Billing.CreatedAt, &item.Billing.UpdatedAt,
		); err != nil {
			return AdminPage[AdminOrganization]{}, fmt.Errorf("scan admin organization: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return AdminPage[AdminOrganization]{}, fmt.Errorf("iterate admin organizations: %w", err)
	}
	page := AdminPage[AdminOrganization]{Items: items}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = fmt.Sprintf("%d", offset+limit)
	}
	return page, nil
}

func (s *Store) AdminOrganizationByID(ctx context.Context, organizationID string) (AdminOrganization, error) {
	page, err := s.AdminOrganizations(ctx, organizationID, 2, 0)
	if err != nil {
		return AdminOrganization{}, err
	}
	for _, organization := range page.Items {
		if organization.ID == organizationID {
			return organization, nil
		}
	}
	return AdminOrganization{}, ErrNotFound
}

func (s *Store) AdminOrganizationMembers(ctx context.Context, organizationID string, limit, offset int) (AdminPage[AdminOrganizationMember], error) {
	if err := s.requireOrganization(ctx, organizationID); err != nil {
		return AdminPage[AdminOrganizationMember]{}, err
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT a.id::text, a.email, m.role, m.created_at
		FROM organization_memberships m
		JOIN accounts a ON a.id = m.account_id
		WHERE m.organization_id::text = $1
		ORDER BY m.created_at, a.id
		LIMIT $2 OFFSET $3`, organizationID, limit+1, offset)
	if err != nil {
		return AdminPage[AdminOrganizationMember]{}, fmt.Errorf("list admin organization members: %w", err)
	}
	defer rows.Close()
	items := make([]AdminOrganizationMember, 0, limit+1)
	for rows.Next() {
		var item AdminOrganizationMember
		if err := rows.Scan(&item.AccountID, &item.Email, &item.Role, &item.CreatedAt); err != nil {
			return AdminPage[AdminOrganizationMember]{}, fmt.Errorf("scan admin organization member: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return AdminPage[AdminOrganizationMember]{}, err
	}
	page := AdminPage[AdminOrganizationMember]{Items: items}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = fmt.Sprintf("%d", offset+limit)
	}
	return page, nil
}

func (s *Store) AdminOrganizationDesigns(ctx context.Context, organizationID string, limit, offset int) (AdminPage[Design], error) {
	if err := s.requireOrganization(ctx, organizationID); err != nil {
		return AdminPage[Design]{}, err
	}
	return s.adminDesigns(ctx, organizationID, "", limit, offset)
}

func (s *Store) requireOrganization(ctx context.Context, organizationID string) error {
	var exists bool
	if err := s.Pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM organizations WHERE id::text = $1)`, organizationID,
	).Scan(&exists); err != nil {
		return fmt.Errorf("check organization: %w", err)
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AdminForks(ctx context.Context, state string, limit, offset int) (AdminPage[Design], error) {
	return s.adminDesigns(ctx, "", state, limit, offset)
}

func (s *Store) adminDesigns(ctx context.Context, organizationID, forkState string, limit, offset int) (AdminPage[Design], error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, organization_id::text, name, component_path,
			COALESCE(forked_from, ''), COALESCE(source_org_id, ''), COALESCE(forked_by, ''), forked_at,
			COALESCE(source_artifact_kind, ''), COALESCE(source_artifact_etag, ''),
			COALESCE(template_ref, ''), COALESCE(fork_idempotency_key, ''), COALESCE(fork_status, ''),
			created_at, updated_at
		FROM designs
		WHERE deleted_at IS NULL
		  AND ($1 = '' OR organization_id = NULLIF($1, '')::uuid)
		  AND ($2 = '' OR (
			fork_idempotency_key IS NOT NULL AND fork_status = $2
			AND EXISTS (
				SELECT 1 FROM organizations workspace
				WHERE workspace.id = designs.organization_id AND workspace.is_platform_workspace
			)
		  ))
		ORDER BY updated_at DESC, id
		LIMIT $3 OFFSET $4`, organizationID, forkState, limit+1, offset)
	if err != nil {
		return AdminPage[Design]{}, fmt.Errorf("list admin designs: %w", err)
	}
	defer rows.Close()
	items := make([]Design, 0, limit+1)
	for rows.Next() {
		design, err := scanDesign(rows)
		if err != nil {
			return AdminPage[Design]{}, err
		}
		items = append(items, design)
	}
	if err := rows.Err(); err != nil {
		return AdminPage[Design]{}, err
	}
	page := AdminPage[Design]{Items: items}
	if len(page.Items) > limit {
		page.Items = page.Items[:limit]
		page.NextCursor = fmt.Sprintf("%d", offset+limit)
	}
	return page, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanDesign(row rowScanner) (Design, error) {
	var design Design
	if err := row.Scan(
		&design.ID, &design.OrganizationID, &design.Name, &design.ComponentPath,
		&design.ForkedFrom, &design.SourceOrganizationID, &design.ForkedBy, &design.ForkedAt,
		&design.SourceArtifactKind, &design.SourceArtifactETag, &design.TemplateRef,
		&design.ForkIdempotencyKey, &design.ForkStatus, &design.CreatedAt, &design.UpdatedAt,
	); err != nil {
		return Design{}, fmt.Errorf("scan design: %w", err)
	}
	return design, nil
}

func (s *Store) AdminDesignByID(ctx context.Context, designID string) (Design, error) {
	row := s.Pool.QueryRow(ctx, `
		SELECT id, organization_id::text, name, component_path,
			COALESCE(forked_from, ''), COALESCE(source_org_id, ''), COALESCE(forked_by, ''), forked_at,
			COALESCE(source_artifact_kind, ''), COALESCE(source_artifact_etag, ''),
			COALESCE(template_ref, ''), COALESCE(fork_idempotency_key, ''), COALESCE(fork_status, ''),
			created_at, updated_at
		FROM designs
		WHERE id = $1 AND deleted_at IS NULL`, designID)
	design, err := scanDesign(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return Design{}, ErrNotFound
	}
	if err != nil {
		return Design{}, err
	}
	return design, nil
}

func (s *Store) CreateFork(
	ctx context.Context,
	sourceDesignID, idempotencyKey, accountID string,
	audit AuditEvent,
) (Design, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Design{}, fmt.Errorf("begin create fork: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	existing, err := designByIdempotencyKeyTx(ctx, tx, idempotencyKey)
	if err == nil {
		if existing.ForkedFrom != sourceDesignID {
			return Design{}, ErrConflict
		}
		return existing, tx.Commit(ctx)
	}
	if !errors.Is(err, ErrNotFound) {
		return Design{}, err
	}

	var source Design
	err = tx.QueryRow(ctx, `
		SELECT id, organization_id::text, name, component_path, created_at, updated_at
		FROM designs
		WHERE id = $1 AND deleted_at IS NULL`, sourceDesignID).Scan(
		&source.ID, &source.OrganizationID, &source.Name, &source.ComponentPath,
		&source.CreatedAt, &source.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Design{}, ErrNotFound
	}
	if err != nil {
		return Design{}, mapStoreError("find fork source", err)
	}
	var workspaceID string
	if err := tx.QueryRow(ctx, `
		SELECT id::text FROM organizations WHERE is_platform_workspace`).Scan(&workspaceID); err != nil {
		return Design{}, mapStoreError("find platform workspace", err)
	}

	var fork Design
	row := tx.QueryRow(ctx, `
		INSERT INTO designs (
			organization_id, name, component_path, forked_from, source_org_id,
			forked_by, forked_at, fork_idempotency_key, fork_status
		) VALUES ($1::uuid, $2, $3, $4, $5, $6, now(), $7, 'pending')
		RETURNING id, organization_id::text, name, component_path,
			COALESCE(forked_from, ''), COALESCE(source_org_id, ''), COALESCE(forked_by, ''), forked_at,
			COALESCE(source_artifact_kind, ''), COALESCE(source_artifact_etag, ''),
			COALESCE(template_ref, ''), COALESCE(fork_idempotency_key, ''), COALESCE(fork_status, ''),
			created_at, updated_at`,
		workspaceID, source.Name, source.ComponentPath, source.ID, source.OrganizationID,
		accountID, idempotencyKey,
	)
	fork, err = scanDesign(row)
	if err != nil {
		return Design{}, mapStoreError("create fork", err)
	}
	audit.OrganizationID = workspaceID
	audit.Action = "admin.fork_created"
	audit.ResourceType = "design"
	audit.ResourceID = fork.ID
	audit.Metadata = ForkAuditMetadata{
		SourceOrganizationID: source.OrganizationID,
		SourceDesignID:       source.ID,
		DestinationForkID:    fork.ID,
	}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return Design{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Design{}, fmt.Errorf("commit create fork: %w", err)
	}
	return fork, nil
}

func designByIdempotencyKeyTx(ctx context.Context, tx pgx.Tx, key string) (Design, error) {
	row := tx.QueryRow(ctx, `
		SELECT id, organization_id::text, name, component_path,
			COALESCE(forked_from, ''), COALESCE(source_org_id, ''), COALESCE(forked_by, ''), forked_at,
			COALESCE(source_artifact_kind, ''), COALESCE(source_artifact_etag, ''),
			COALESCE(template_ref, ''), COALESCE(fork_idempotency_key, ''), COALESCE(fork_status, ''),
			created_at, updated_at
		FROM designs
		WHERE fork_idempotency_key = $1
		FOR UPDATE`, key)
	design, err := scanDesign(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Design{}, ErrNotFound
		}
		return Design{}, err
	}
	return design, nil
}

func (s *Store) FinalizeFork(
	ctx context.Context,
	forkID string,
	finalize ForkFinalize,
	audit AuditEvent,
) (Design, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Design{}, fmt.Errorf("begin finalize fork: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(ctx, `
		SELECT id, organization_id::text, name, component_path,
			COALESCE(forked_from, ''), COALESCE(source_org_id, ''), COALESCE(forked_by, ''), forked_at,
			COALESCE(source_artifact_kind, ''), COALESCE(source_artifact_etag, ''),
			COALESCE(template_ref, ''), COALESCE(fork_idempotency_key, ''), COALESCE(fork_status, ''),
			created_at, updated_at
		FROM designs WHERE id = $1 AND deleted_at IS NULL
		FOR UPDATE`, forkID)
	current, err := scanDesign(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Design{}, ErrNotFound
		}
		return Design{}, err
	}
	if current.ForkIdempotencyKey == "" {
		return Design{}, ErrNotFound
	}
	identical := current.ForkStatus == finalize.Status &&
		current.SourceArtifactKind == finalize.SourceArtifactKind &&
		current.SourceArtifactETag == finalize.SourceETag && current.TemplateRef == finalize.TemplateRef
	if identical || (current.ForkStatus == "failed" && finalize.Status == "failed") {
		return current, tx.Commit(ctx)
	}
	if current.ForkStatus == "ready" || finalize.Status == "pending" ||
		(finalize.Status == "failed" && current.ForkStatus != "pending") ||
		(finalize.Status == "ready" && current.ForkStatus != "pending" && current.ForkStatus != "failed") {
		return Design{}, ErrInvalidState
	}

	row = tx.QueryRow(ctx, `
		UPDATE designs
		SET fork_status = $2, source_artifact_kind = NULLIF($3, ''),
			source_artifact_etag = NULLIF($4, ''), template_ref = NULLIF($5, ''),
			updated_at = now()
		WHERE id = $1
		RETURNING id, organization_id::text, name, component_path,
			COALESCE(forked_from, ''), COALESCE(source_org_id, ''), COALESCE(forked_by, ''), forked_at,
			COALESCE(source_artifact_kind, ''), COALESCE(source_artifact_etag, ''),
			COALESCE(template_ref, ''), COALESCE(fork_idempotency_key, ''), COALESCE(fork_status, ''),
			created_at, updated_at`, forkID, finalize.Status, finalize.SourceArtifactKind,
		finalize.SourceETag, finalize.TemplateRef)
	updated, err := scanDesign(row)
	if err != nil {
		return Design{}, mapStoreError("finalize fork", err)
	}
	audit.OrganizationID = updated.OrganizationID
	audit.Action = "admin.fork_finalized"
	audit.ResourceType = "design"
	audit.ResourceID = updated.ID
	audit.Metadata = ForkAuditMetadata{
		SourceOrganizationID: updated.SourceOrganizationID,
		SourceDesignID:       updated.ForkedFrom,
		DestinationForkID:    updated.ID,
		SourceArtifactKind:   updated.SourceArtifactKind,
		SourceETag:           updated.SourceArtifactETag,
		TemplateRef:          updated.TemplateRef,
	}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return Design{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Design{}, fmt.Errorf("commit finalize fork: %w", err)
	}
	return updated, nil
}

func (s *Store) BootstrapPlatformWorkspace(
	ctx context.Context,
	p CreateOrganizationParams,
	audit AuditEvent,
) (Organization, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Organization{}, fmt.Errorf("begin workspace bootstrap: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	workspace, err := platformWorkspaceTx(ctx, tx)
	if errors.Is(err, ErrNotFound) {
		var slugOwnerWorkspace bool
		err := tx.QueryRow(ctx, `
			SELECT is_platform_workspace FROM organizations WHERE slug = $1`, PlatformWorkspaceSlug,
		).Scan(&slugOwnerWorkspace)
		if err == nil && !slugOwnerWorkspace {
			return Organization{}, ErrConflict
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return Organization{}, mapStoreError("check workspace slug", err)
		}
		p.Name = "Archura Platform Workspace"
		p.Slug = PlatformWorkspaceSlug
		p.AllowedOrigins = []string{}
		workspace, err = insertOrganization(ctx, tx, p)
		if err != nil {
			return Organization{}, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE organizations
			SET is_platform_workspace = true, caps_exempt = true
			WHERE id = $1::uuid`, workspace.ID); err != nil {
			return Organization{}, mapStoreError("mark platform workspace", err)
		}
		audit.OrganizationID = workspace.ID
		audit.Action = "organization.created"
		audit.ResourceType = "organization"
		audit.ResourceID = workspace.ID
		audit.Metadata = OrganizationAuditMetadata{}
		if err := insertAudit(ctx, tx, audit); err != nil {
			return Organization{}, err
		}
	} else if err != nil {
		return Organization{}, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE organizations SET caps_exempt = true WHERE id = $1::uuid`, workspace.ID); err != nil {
		return Organization{}, mapStoreError("exempt platform workspace", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE organization_billing SET free_no_expiry = true, updated_at = now()
		WHERE organization_id = $1::uuid`, workspace.ID); err != nil {
		return Organization{}, mapStoreError("keep platform workspace active", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM organization_memberships m
		WHERE m.organization_id = $1::uuid
		  AND NOT EXISTS (
			SELECT 1 FROM accounts a
			WHERE a.id = m.account_id AND a.staff_role = 'platform_owner'
		  )`, workspace.ID); err != nil {
		return Organization{}, mapStoreError("remove stale workspace memberships", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO organization_memberships (account_id, organization_id, role, is_default)
		SELECT id, $1::uuid, 'owner', false FROM accounts WHERE staff_role = 'platform_owner'
		ON CONFLICT (account_id, organization_id) DO UPDATE SET role = 'owner'`, workspace.ID); err != nil {
		return Organization{}, mapStoreError("synchronize platform workspace", err)
	}
	workspace.CapsExempt = true
	workspace.IsPlatformWorkspace = true
	if err := tx.Commit(ctx); err != nil {
		return Organization{}, fmt.Errorf("commit workspace bootstrap: %w", err)
	}
	return workspace, nil
}

func platformWorkspaceTx(ctx context.Context, tx pgx.Tx) (Organization, error) {
	var workspace Organization
	err := tx.QueryRow(ctx, `
		SELECT id::text, name, slug, allowed_origins, status, caps_exempt,
			is_platform_workspace, created_at
		FROM organizations
		WHERE is_platform_workspace
		FOR UPDATE`).Scan(
		&workspace.ID, &workspace.Name, &workspace.Slug, &workspace.AllowedOrigins,
		&workspace.Status, &workspace.CapsExempt, &workspace.IsPlatformWorkspace,
		&workspace.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Organization{}, ErrNotFound
	}
	if err != nil {
		return Organization{}, mapStoreError("find platform workspace", err)
	}
	return workspace, nil
}

func (s *Store) GrantStaff(ctx context.Context, accountIdentifier string, audit AuditEvent) (Account, error) {
	return s.setStaff(ctx, accountIdentifier, true, audit)
}

func (s *Store) RevokeStaff(ctx context.Context, accountIdentifier string, audit AuditEvent) (Account, error) {
	return s.setStaff(ctx, accountIdentifier, false, audit)
}

func (s *Store) setStaff(ctx context.Context, accountIdentifier string, grant bool, audit AuditEvent) (Account, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Account{}, fmt.Errorf("begin staff update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	role := ""
	action := "admin.staff_revoked"
	if grant {
		role = "platform_owner"
		action = "admin.staff_granted"
	}
	var account Account
	err = tx.QueryRow(ctx, `
		UPDATE accounts
		SET staff_role = NULLIF($2, '')
		WHERE id::text = $1 OR lower(email) = lower($1)
		RETURNING id::text, email, email_verified_at, COALESCE(staff_role, ''), created_at`,
		strings.TrimSpace(accountIdentifier), role,
	).Scan(&account.ID, &account.Email, &account.EmailVerifiedAt, &account.StaffRole, &account.CreatedAt)
	if err != nil {
		return Account{}, mapStoreError("update staff role", err)
	}
	workspace, err := platformWorkspaceTx(ctx, tx)
	if err != nil {
		return Account{}, err
	}
	if grant {
		_, err = tx.Exec(ctx, `
			INSERT INTO organization_memberships (account_id, organization_id, role, is_default)
			VALUES ($1::uuid, $2::uuid, 'owner', false)
			ON CONFLICT (account_id, organization_id) DO UPDATE SET role = 'owner'`,
			account.ID, workspace.ID)
	} else {
		_, err = tx.Exec(ctx, `
			DELETE FROM organization_memberships
			WHERE account_id = $1::uuid AND organization_id = $2::uuid`, account.ID, workspace.ID)
	}
	if err != nil {
		return Account{}, mapStoreError("synchronize staff workspace membership", err)
	}
	audit.OrganizationID = workspace.ID
	audit.Action = action
	audit.ResourceType = "account"
	audit.ResourceID = account.ID
	audit.Metadata = EmptyAuditMetadata{}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return Account{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Account{}, fmt.Errorf("commit staff update: %w", err)
	}
	return account, nil
}
