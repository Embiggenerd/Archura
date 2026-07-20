package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateConfirmation(ctx context.Context, confirmation EmailConfirmation, audit AuditEvent) (EmailConfirmation, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return EmailConfirmation{}, fmt.Errorf("begin create confirmation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var created EmailConfirmation
	err = tx.QueryRow(ctx, `
		INSERT INTO email_confirmations (token_hash, email, subdomain, expires_at)
		VALUES ($1, $2, $3, $4)
		RETURNING id::text, token_hash, email, subdomain, expires_at, used_at, created_at`,
		confirmation.TokenHash, confirmation.Email, confirmation.Subdomain, confirmation.ExpiresAt,
	).Scan(
		&created.ID, &created.TokenHash, &created.Email, &created.Subdomain,
		&created.ExpiresAt, &created.UsedAt, &created.CreatedAt,
	)
	if err != nil {
		return EmailConfirmation{}, mapStoreError("create confirmation", err)
	}
	audit.ResourceID = created.ID
	if err := insertAudit(ctx, tx, audit); err != nil {
		return EmailConfirmation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return EmailConfirmation{}, fmt.Errorf("commit create confirmation: %w", err)
	}
	return created, nil
}

func (s *Store) ConfirmationByTokenHash(ctx context.Context, hash string) (EmailConfirmation, error) {
	var confirmation EmailConfirmation
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, token_hash, email, subdomain, expires_at, used_at, created_at
		FROM email_confirmations
		WHERE token_hash = $1`, hash,
	).Scan(
		&confirmation.ID, &confirmation.TokenHash, &confirmation.Email, &confirmation.Subdomain,
		&confirmation.ExpiresAt, &confirmation.UsedAt, &confirmation.CreatedAt,
	)
	if err != nil {
		return EmailConfirmation{}, mapStoreError("find confirmation", err)
	}
	return confirmation, nil
}

func (s *Store) AccountByEmail(ctx context.Context, email string) (Account, error) {
	var account Account
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, email, email_verified_at, created_at
		FROM accounts
		WHERE email = $1`, email,
	).Scan(&account.ID, &account.Email, &account.EmailVerifiedAt, &account.CreatedAt)
	if err != nil {
		return Account{}, mapStoreError("find account by email", err)
	}
	return account, nil
}

func (s *Store) VerifyConfirmation(ctx context.Context, p VerifyConfirmationParams) (VerifyConfirmationResult, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return VerifyConfirmationResult{}, fmt.Errorf("begin verify confirmation: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var confirmation EmailConfirmation
	err = tx.QueryRow(ctx, `
		SELECT id::text, token_hash, email, subdomain, expires_at, used_at, created_at
		FROM email_confirmations
		WHERE token_hash = $1
		FOR UPDATE`, p.TokenHash,
	).Scan(
		&confirmation.ID, &confirmation.TokenHash, &confirmation.Email, &confirmation.Subdomain,
		&confirmation.ExpiresAt, &confirmation.UsedAt, &confirmation.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return VerifyConfirmationResult{}, ErrNotFound
	}
	if err != nil {
		return VerifyConfirmationResult{}, fmt.Errorf("lock confirmation: %w", err)
	}
	if confirmation.UsedAt != nil {
		return VerifyConfirmationResult{}, ErrNotFound
	}
	var unexpired bool
	if err := tx.QueryRow(ctx, `SELECT $1 > now()`, confirmation.ExpiresAt).Scan(&unexpired); err != nil {
		return VerifyConfirmationResult{}, fmt.Errorf("check confirmation expiry: %w", err)
	}
	if !unexpired {
		return VerifyConfirmationResult{}, ErrNotFound
	}

	account, created, err := upsertAccount(ctx, tx, confirmation.Email)
	if err != nil {
		return VerifyConfirmationResult{}, err
	}
	organization, publishableKey, err := ensureDefaultOrganization(ctx, tx, account, CreateOrganizationParams{
		PublishableKey: p.PublishableKey,
		SecretKeyHash:  p.SecretKeyHash,
		AllowedOrigins: []string{},
	}, p.RequestID)
	if err != nil {
		return VerifyConfirmationResult{}, err
	}
	if confirmation.Subdomain != nil {
		ownerID, err := bindOrganizationSite(ctx, tx, *confirmation.Subdomain, organization.ID)
		if err != nil {
			return VerifyConfirmationResult{}, err
		}
		if ownerID != organization.ID {
			return VerifyConfirmationResult{}, ErrConflict
		}
	}

	var session AccountSession
	err = tx.QueryRow(ctx, `
		INSERT INTO account_sessions (token_hash, account_id, expires_at)
		VALUES ($1, $2::uuid, $3)
		RETURNING id::text, token_hash, account_id::text, expires_at, revoked_at, created_at`,
		p.SessionTokenHash, account.ID, p.SessionExpiresAt,
	).Scan(
		&session.ID, &session.TokenHash, &session.AccountID,
		&session.ExpiresAt, &session.RevokedAt, &session.CreatedAt,
	)
	if err != nil {
		return VerifyConfirmationResult{}, mapStoreError("create account session", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE email_confirmations SET used_at = now() WHERE id = $1::uuid`, confirmation.ID); err != nil {
		return VerifyConfirmationResult{}, fmt.Errorf("mark confirmation used: %w", err)
	}

	audits := []AuditEvent{
		{OrganizationID: organization.ID, ActorType: "account", ActorID: account.ID, Action: "confirmation.verified", ResourceType: "confirmation", ResourceID: confirmation.ID, RequestID: p.RequestID, Metadata: EmptyAuditMetadata{}},
	}
	if created {
		audits = append(audits, AuditEvent{OrganizationID: organization.ID, ActorType: "account", ActorID: account.ID, Action: "account.created", ResourceType: "account", ResourceID: account.ID, RequestID: p.RequestID, Metadata: EmptyAuditMetadata{}})
	}
	if confirmation.Subdomain != nil {
		audits = append(audits, AuditEvent{OrganizationID: organization.ID, ActorType: "account", ActorID: account.ID, Action: "site_ownership.bound", ResourceType: "site", ResourceID: *confirmation.Subdomain, RequestID: p.RequestID, Metadata: EmptyAuditMetadata{}})
	}
	audits = append(audits, AuditEvent{OrganizationID: organization.ID, ActorType: "account", ActorID: account.ID, Action: "session.created", ResourceType: "session", ResourceID: session.ID, RequestID: p.RequestID, Metadata: EmptyAuditMetadata{}})
	for _, audit := range audits {
		if err := insertAudit(ctx, tx, audit); err != nil {
			return VerifyConfirmationResult{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return VerifyConfirmationResult{}, fmt.Errorf("commit verify confirmation: %w", err)
	}
	return VerifyConfirmationResult{
		Account: account, Organization: organization, PublishableKey: publishableKey,
		Subdomain: confirmation.Subdomain, Session: session,
	}, nil
}

func upsertAccount(ctx context.Context, tx pgx.Tx, email string) (Account, bool, error) {
	var account Account
	err := tx.QueryRow(ctx, `
		INSERT INTO accounts (email, email_verified_at)
		VALUES ($1, now())
		ON CONFLICT (email) DO NOTHING
		RETURNING id::text, email, email_verified_at, created_at`, email,
	).Scan(&account.ID, &account.Email, &account.EmailVerifiedAt, &account.CreatedAt)
	if err == nil {
		return account, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Account{}, false, mapStoreError("create account", err)
	}
	err = tx.QueryRow(ctx, `
		UPDATE accounts
		SET email_verified_at = COALESCE(email_verified_at, now())
		WHERE email = $1
		RETURNING id::text, email, email_verified_at, created_at`, email,
	).Scan(&account.ID, &account.Email, &account.EmailVerifiedAt, &account.CreatedAt)
	if err != nil {
		return Account{}, false, mapStoreError("verify existing account", err)
	}
	return account, false, nil
}

func (s *Store) SessionByTokenHash(ctx context.Context, hash string) (AccountSession, error) {
	var session AccountSession
	err := s.Pool.QueryRow(ctx, `
		SELECT id::text, token_hash, account_id::text, expires_at, revoked_at, created_at
		FROM account_sessions
		WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`, hash,
	).Scan(
		&session.ID, &session.TokenHash, &session.AccountID,
		&session.ExpiresAt, &session.RevokedAt, &session.CreatedAt,
	)
	if err != nil {
		return AccountSession{}, mapStoreError("find account session", err)
	}
	return session, nil
}

func (s *Store) RevokeSessionByTokenHash(ctx context.Context, hash string) error {
	if _, err := s.Pool.Exec(ctx, `
		UPDATE account_sessions
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE token_hash = $1`, hash); err != nil {
		return fmt.Errorf("revoke account session: %w", err)
	}
	return nil
}

func (s *Store) AccountByID(ctx context.Context, id string) (Account, error) {
	var account Account
	err := s.Pool.QueryRow(ctx, `SELECT id::text, email, email_verified_at, created_at FROM accounts WHERE id = $1::uuid`, id).
		Scan(&account.ID, &account.Email, &account.EmailVerifiedAt, &account.CreatedAt)
	if err != nil {
		return Account{}, mapStoreError("find account", err)
	}
	return account, nil
}

func (s *Store) SitesForAccount(ctx context.Context, accountID string) ([]string, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT sites.subdomain
		FROM organization_sites sites
		JOIN organization_memberships memberships
			ON memberships.organization_id = sites.organization_id
		WHERE memberships.account_id = $1::uuid
		ORDER BY sites.subdomain`, accountID)
	if err != nil {
		return nil, fmt.Errorf("list account sites: %w", err)
	}
	defer rows.Close()
	sites := make([]string, 0)
	for rows.Next() {
		var site string
		if err := rows.Scan(&site); err != nil {
			return nil, fmt.Errorf("scan account site: %w", err)
		}
		sites = append(sites, site)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate account sites: %w", err)
	}
	return sites, nil
}

func (s *Store) BindSiteOwnership(ctx context.Context, subdomain, accountID string, audit AuditEvent) error {
	organizations, err := s.OrganizationsForAccount(ctx, accountID)
	if err != nil {
		return err
	}
	for _, organization := range organizations {
		if organization.IsDefault {
			return s.BindOrganizationSite(ctx, subdomain, organization.ID, accountID, audit)
		}
	}
	return ErrNotFound
}
