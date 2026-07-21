package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrConflict      = errors.New("store conflict")
	ErrAlreadyMember = errors.New("account is already an organization member")
	ErrNotFound      = errors.New("store record not found")
	ErrLimitReached  = errors.New("plan limit reached")
)

func (s *Store) CreateOrganization(ctx context.Context, p CreateOrganizationParams, audit AuditEvent) (Organization, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return Organization{}, fmt.Errorf("begin create organization: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var organization Organization
	err = tx.QueryRow(ctx, `
		INSERT INTO organizations (name, slug, allowed_origins, edge_claim_token)
		VALUES ($1, $2, $3, NULLIF($4, ''))
		RETURNING id::text, name, slug, allowed_origins, status, created_at`,
		p.Name, p.Slug, p.AllowedOrigins, p.EdgeClaimToken,
	).Scan(&organization.ID, &organization.Name, &organization.Slug, &organization.AllowedOrigins, &organization.Status, &organization.CreatedAt)
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
	audit.OrganizationID = organization.ID
	audit.ResourceID = organization.ID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return Organization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Organization{}, fmt.Errorf("commit create organization: %w", err)
	}
	return organization, nil
}

func (s *Store) OrganizationBySecretHash(ctx context.Context, hash string) (Organization, error) {
	var organization Organization
	err := s.Pool.QueryRow(ctx, `
		SELECT t.id::text, t.name, t.slug, t.allowed_origins, t.status, t.created_at
		FROM organizations t
		JOIN organization_api_keys k ON k.organization_id = t.id
		WHERE k.secret_key_hash = $1 AND k.revoked_at IS NULL AND t.status = 'active'`,
		hash,
	).Scan(&organization.ID, &organization.Name, &organization.Slug, &organization.AllowedOrigins, &organization.Status, &organization.CreatedAt)
	if err != nil {
		return Organization{}, mapStoreError("find organization by secret", err)
	}
	return organization, nil
}

func (s *Store) UpsertPaymentComponent(ctx context.Context, component PaymentComponent, audit AuditEvent) (PaymentComponent, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return PaymentComponent{}, fmt.Errorf("begin save payment component: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var saved PaymentComponent
	err = tx.QueryRow(ctx, `
		INSERT INTO payment_components (
			id, organization_id, mode, stripe_price_id, success_url, cancel_url, allowed_origins, status
		) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (id) DO UPDATE SET
			mode = EXCLUDED.mode,
			stripe_price_id = EXCLUDED.stripe_price_id,
			success_url = EXCLUDED.success_url,
			cancel_url = EXCLUDED.cancel_url,
			allowed_origins = EXCLUDED.allowed_origins,
			status = EXCLUDED.status,
			updated_at = now()
		WHERE payment_components.organization_id = EXCLUDED.organization_id
		RETURNING id, organization_id::text, mode, stripe_price_id, success_url, cancel_url,
			allowed_origins, status, created_at, updated_at`,
		component.ID, component.OrganizationID, component.Mode, component.StripePriceID,
		component.SuccessURL, component.CancelURL, component.AllowedOrigins, component.Status,
	).Scan(
		&saved.ID, &saved.OrganizationID, &saved.Mode, &saved.StripePriceID,
		&saved.SuccessURL, &saved.CancelURL, &saved.AllowedOrigins, &saved.Status,
		&saved.CreatedAt, &saved.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return PaymentComponent{}, ErrNotFound
	}
	if err != nil {
		return PaymentComponent{}, mapStoreError("upsert payment component", err)
	}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return PaymentComponent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PaymentComponent{}, fmt.Errorf("commit payment component: %w", err)
	}
	return saved, nil
}

func (s *Store) PaymentComponentForOrganization(ctx context.Context, organizationID, componentID string) (PaymentComponent, error) {
	var component PaymentComponent
	err := s.Pool.QueryRow(ctx, `
		SELECT id, organization_id::text, mode, stripe_price_id, success_url, cancel_url,
			allowed_origins, status, created_at, updated_at
		FROM payment_components
		WHERE id = $1 AND organization_id = $2::uuid AND status = 'active'`,
		componentID, organizationID,
	).Scan(
		&component.ID, &component.OrganizationID, &component.Mode, &component.StripePriceID,
		&component.SuccessURL, &component.CancelURL, &component.AllowedOrigins, &component.Status,
		&component.CreatedAt, &component.UpdatedAt,
	)
	if err != nil {
		return PaymentComponent{}, mapStoreError("find payment component", err)
	}
	return component, nil
}

func (s *Store) CreateComponentSession(ctx context.Context, session ComponentSession, audit AuditEvent) (ComponentSession, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return ComponentSession{}, fmt.Errorf("begin create component session: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var created ComponentSession
	err = tx.QueryRow(ctx, `
		INSERT INTO component_sessions (
			id, token_hash, organization_id, component_id, external_user_id, scopes,
			audience, allowed_origin, expires_at
		) VALUES ($1, $2, $3::uuid, $4, NULLIF($5, ''), $6, $7, $8, $9)
		RETURNING id, token_hash, organization_id::text, component_id,
			COALESCE(external_user_id, ''), scopes, audience, allowed_origin,
			expires_at, revoked_at, created_at`,
		session.ID, session.TokenHash, session.OrganizationID, session.ComponentID,
		session.ExternalUserID, session.Scopes, session.Audience,
		session.AllowedOrigin, session.ExpiresAt,
	).Scan(
		&created.ID, &created.TokenHash, &created.OrganizationID, &created.ComponentID,
		&created.ExternalUserID, &created.Scopes, &created.Audience,
		&created.AllowedOrigin, &created.ExpiresAt, &created.RevokedAt, &created.CreatedAt,
	)
	if err != nil {
		return ComponentSession{}, mapStoreError("create component session", err)
	}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return ComponentSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ComponentSession{}, fmt.Errorf("commit component session: %w", err)
	}
	return created, nil
}

func (s *Store) ComponentSessionByTokenHash(ctx context.Context, hash string) (ComponentSession, error) {
	var session ComponentSession
	err := s.Pool.QueryRow(ctx, `
		SELECT id, token_hash, organization_id::text, component_id,
			COALESCE(external_user_id, ''), scopes, audience, allowed_origin,
			expires_at, revoked_at, created_at
		FROM component_sessions
		WHERE token_hash = $1`, hash,
	).Scan(
		&session.ID, &session.TokenHash, &session.OrganizationID, &session.ComponentID,
		&session.ExternalUserID, &session.Scopes, &session.Audience,
		&session.AllowedOrigin, &session.ExpiresAt, &session.RevokedAt, &session.CreatedAt,
	)
	if err != nil {
		return ComponentSession{}, mapStoreError("find component session", err)
	}
	return session, nil
}

func mapStoreError(operation string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrConflict
	}
	return fmt.Errorf("%s: %w", operation, err)
}
