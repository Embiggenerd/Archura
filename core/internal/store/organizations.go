package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateOrganizationForAccount(
	ctx context.Context,
	accountID string,
	p CreateOrganizationParams,
	audit AuditEvent,
) (AccountOrganization, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return AccountOrganization{}, fmt.Errorf("begin create organization: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	organization, err := insertOrganization(ctx, tx, p)
	if err != nil {
		return AccountOrganization{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO organization_memberships (account_id, organization_id, role, is_default)
		VALUES ($1::uuid, $2::uuid, 'owner', false)`, accountID, organization.ID); err != nil {
		return AccountOrganization{}, mapStoreError("create organization membership", err)
	}

	audit.OrganizationID = organization.ID
	audit.ResourceID = organization.ID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return AccountOrganization{}, err
	}
	if err := insertAudit(ctx, tx, AuditEvent{
		OrganizationID: organization.ID,
		ActorType:      "account",
		ActorID:        accountID,
		Action:         "membership.created",
		ResourceType:   "membership",
		ResourceID:     accountID + ":" + organization.ID,
		RequestID:      audit.RequestID,
		Metadata:       EmptyAuditMetadata{},
	}); err != nil {
		return AccountOrganization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AccountOrganization{}, fmt.Errorf("commit create organization: %w", err)
	}
	return AccountOrganization{
		Organization:   organization,
		Role:           "owner",
		IsDefault:      false,
		PublishableKey: p.PublishableKey,
		Sites:          []string{},
	}, nil
}

func insertOrganization(ctx context.Context, tx pgx.Tx, p CreateOrganizationParams) (Organization, error) {
	var organization Organization
	err := tx.QueryRow(ctx, `
		INSERT INTO organizations (name, slug, allowed_origins, edge_claim_token)
		VALUES ($1, $2, $3, NULLIF($4, ''))
		RETURNING id::text, name, slug, allowed_origins, status, created_at`,
		p.Name, p.Slug, p.AllowedOrigins, p.EdgeClaimToken,
	).Scan(
		&organization.ID, &organization.Name, &organization.Slug,
		&organization.AllowedOrigins, &organization.Status, &organization.CreatedAt,
	)
	if err != nil {
		return Organization{}, mapStoreError("insert organization", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO organization_api_keys (organization_id, publishable_key, secret_key_hash)
		VALUES ($1::uuid, $2, $3)`,
		organization.ID, p.PublishableKey, p.SecretKeyHash,
	); err != nil {
		return Organization{}, mapStoreError("insert organization keys", err)
	}
	result, err := tx.Exec(ctx, `
		INSERT INTO organization_billing (
			organization_id, free_trial_days, free_design_limit, free_site_limit, free_no_expiry
		)
		SELECT $1::uuid, trial_days, free_design_limit, free_site_limit, free_no_expiry
		FROM default_free_plan
		WHERE singleton`, organization.ID)
	if err != nil {
		return Organization{}, mapStoreError("insert organization billing", err)
	}
	if result.RowsAffected() != 1 {
		return Organization{}, errors.New("default free plan is missing")
	}
	return organization, nil
}

// EnsureDefaultOrganization makes old accounts migration-safe and is also
// used when a new account is confirmed. It is idempotent.
func (s *Store) EnsureDefaultOrganization(
	ctx context.Context,
	account Account,
	p CreateOrganizationParams,
	requestID string,
) (AccountOrganization, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return AccountOrganization{}, fmt.Errorf("begin ensure default organization: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	organization, publishableKey, err := ensureDefaultOrganization(ctx, tx, account, p, requestID)
	if err != nil {
		return AccountOrganization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AccountOrganization{}, fmt.Errorf("commit ensure default organization: %w", err)
	}
	return AccountOrganization{
		Organization:   organization,
		Role:           "owner",
		IsDefault:      true,
		PublishableKey: publishableKey,
		Sites:          []string{},
	}, nil
}

func ensureDefaultOrganization(
	ctx context.Context,
	tx pgx.Tx,
	account Account,
	p CreateOrganizationParams,
	requestID string,
) (Organization, string, error) {
	var organization Organization
	err := tx.QueryRow(ctx, `
		SELECT o.id::text, o.name, o.slug, o.allowed_origins, o.status, o.created_at
		FROM organization_memberships m
		JOIN organizations o ON o.id = m.organization_id
		WHERE m.account_id = $1::uuid AND m.is_default
		FOR UPDATE`, account.ID,
	).Scan(
		&organization.ID, &organization.Name, &organization.Slug,
		&organization.AllowedOrigins, &organization.Status, &organization.CreatedAt,
	)
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		p.Name = defaultOrganizationName(account.Email)
		p.Slug = defaultOrganizationSlug(account.ID)
		organization, err = insertOrganization(ctx, tx, p)
		if err != nil {
			return Organization{}, "", err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO organization_memberships (account_id, organization_id, role, is_default)
			VALUES ($1::uuid, $2::uuid, 'owner', true)`, account.ID, organization.ID); err != nil {
			return Organization{}, "", mapStoreError("create default organization membership", err)
		}
		created = true
	} else if err != nil {
		return Organization{}, "", mapStoreError("find default organization", err)
	}

	var publishableKey string
	err = tx.QueryRow(ctx, `
		SELECT publishable_key
		FROM organization_api_keys
		WHERE organization_id = $1::uuid AND revoked_at IS NULL
		ORDER BY created_at DESC
		LIMIT 1`, organization.ID).Scan(&publishableKey)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := tx.Exec(ctx, `
			INSERT INTO organization_api_keys (organization_id, publishable_key, secret_key_hash)
			VALUES ($1::uuid, $2, $3)`, organization.ID, p.PublishableKey, p.SecretKeyHash); err != nil {
			return Organization{}, "", mapStoreError("create default organization keys", err)
		}
		publishableKey = p.PublishableKey
	} else if err != nil {
		return Organization{}, "", mapStoreError("find default organization key", err)
	}

	if created {
		if err := insertAudit(ctx, tx, AuditEvent{
			OrganizationID: organization.ID,
			ActorType:      "account",
			ActorID:        account.ID,
			Action:         "organization.created",
			ResourceType:   "organization",
			ResourceID:     organization.ID,
			RequestID:      requestID,
			Metadata:       OrganizationAuditMetadata{},
		}); err != nil {
			return Organization{}, "", err
		}
		if err := insertAudit(ctx, tx, AuditEvent{
			OrganizationID: organization.ID,
			ActorType:      "account",
			ActorID:        account.ID,
			Action:         "membership.created",
			ResourceType:   "membership",
			ResourceID:     account.ID + ":" + organization.ID,
			RequestID:      requestID,
			Metadata:       EmptyAuditMetadata{},
		}); err != nil {
			return Organization{}, "", err
		}
	}
	return organization, publishableKey, nil
}

func (s *Store) OrganizationsForAccount(ctx context.Context, accountID string) ([]AccountOrganization, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT o.id::text, o.name, o.slug, o.allowed_origins, o.status, o.created_at,
			m.role, m.is_default, COALESCE(k.publishable_key, ''), sites.subdomain
		FROM organization_memberships m
		JOIN organizations o ON o.id = m.organization_id
		LEFT JOIN LATERAL (
			SELECT publishable_key
			FROM organization_api_keys
			WHERE organization_id = o.id AND revoked_at IS NULL
			ORDER BY created_at DESC
			LIMIT 1
		) k ON true
		LEFT JOIN organization_sites sites ON sites.organization_id = o.id
		WHERE m.account_id = $1::uuid
		ORDER BY m.is_default DESC, o.created_at, sites.subdomain`, accountID)
	if err != nil {
		return nil, fmt.Errorf("list account organizations: %w", err)
	}
	defer rows.Close()

	organizations := make([]AccountOrganization, 0)
	byID := make(map[string]int)
	for rows.Next() {
		var item AccountOrganization
		var site *string
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Slug, &item.AllowedOrigins, &item.Status, &item.CreatedAt,
			&item.Role, &item.IsDefault, &item.PublishableKey, &site,
		); err != nil {
			return nil, fmt.Errorf("scan account organization: %w", err)
		}
		index, exists := byID[item.ID]
		if !exists {
			item.Sites = make([]string, 0)
			organizations = append(organizations, item)
			index = len(organizations) - 1
			byID[item.ID] = index
		}
		if site != nil {
			organizations[index].Sites = append(organizations[index].Sites, *site)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate account organizations: %w", err)
	}
	return organizations, nil
}

func (s *Store) BindOrganizationSite(
	ctx context.Context,
	subdomain, organizationID, accountID string,
	audit AuditEvent,
) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin bind organization site: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var member bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM organization_memberships
			WHERE account_id = $1::uuid AND organization_id = $2::uuid
		)`, accountID, organizationID).Scan(&member); err != nil {
		return fmt.Errorf("check organization membership: %w", err)
	}
	if !member {
		return ErrNotFound
	}
	ownerID, err := bindOrganizationSite(ctx, tx, subdomain, organizationID)
	if err != nil {
		return err
	}
	if ownerID != organizationID {
		return ErrConflict
	}
	audit.OrganizationID = organizationID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bind organization site: %w", err)
	}
	return nil
}

func (s *Store) ReleaseOrganizationSite(
	ctx context.Context,
	subdomain, organizationID string,
	audit AuditEvent,
) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin release organization site: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := tx.Exec(ctx, `
		DELETE FROM organization_sites
		WHERE subdomain = $1 AND organization_id = $2::uuid`, subdomain, organizationID)
	if err != nil {
		return fmt.Errorf("release organization site: %w", err)
	}
	if result.RowsAffected() == 0 {
		return tx.Commit(ctx)
	}
	audit.OrganizationID = organizationID
	audit.Action = "site_ownership.released"
	audit.ResourceType = "site"
	audit.ResourceID = subdomain
	if err := insertAudit(ctx, tx, audit); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit release organization site: %w", err)
	}
	return nil
}

func bindOrganizationSite(ctx context.Context, tx pgx.Tx, subdomain, organizationID string) (string, error) {
	var existingOwner string
	err := tx.QueryRow(ctx, `
		SELECT organization_id::text FROM organization_sites WHERE subdomain = $1`, subdomain,
	).Scan(&existingOwner)
	if err == nil {
		return existingOwner, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", mapStoreError("find organization site owner", err)
	}
	limits, exempt, err := effectiveResourceLimitsTx(ctx, tx, organizationID, time.Now().UTC())
	if err != nil {
		return "", err
	}
	result, err := tx.Exec(ctx, `
		INSERT INTO organization_sites (subdomain, organization_id)
		SELECT $1, $2::uuid
		WHERE $3 OR (
			SELECT count(*) FROM organization_sites WHERE organization_id = $2::uuid
		) < $4
		ON CONFLICT DO NOTHING`, subdomain, organizationID, exempt, limits.Sites)
	if err != nil {
		return "", mapStoreError("bind organization site", err)
	}
	if result.RowsAffected() == 0 {
		var ownerID string
		err := tx.QueryRow(ctx, `
			SELECT organization_id::text FROM organization_sites WHERE subdomain = $1`, subdomain,
		).Scan(&ownerID)
		if err == nil {
			return ownerID, nil
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrLimitReached
		}
		return "", mapStoreError("find organization site owner", err)
	}
	var ownerID string
	if err := tx.QueryRow(ctx, `
		SELECT organization_id::text FROM organization_sites WHERE subdomain = $1`, subdomain,
	).Scan(&ownerID); err != nil {
		return "", mapStoreError("find organization site owner", err)
	}
	return ownerID, nil
}

func defaultOrganizationName(email string) string {
	name := strings.TrimSpace(strings.SplitN(email, "@", 2)[0])
	if name == "" {
		name = "My"
		return name + " organization"
	}
	return name + "'s organization"
}

func defaultOrganizationSlug(accountID string) string {
	compact := strings.ReplaceAll(accountID, "-", "")
	if len(compact) > 20 {
		compact = compact[:20]
	}
	return "org-" + strings.ToLower(compact)
}
