package store

import (
	"context"
	"fmt"
	"time"
)

// AdminSessionInfo carries the account plus MFA/elevation state for the current
// session — everything the admin gate needs to decide step-up in one query.
// MFASecret is loaded only through this admin-scoped path, never on ordinary
// account authentication.
type AdminSessionInfo struct {
	Account       Account
	MFASecret     string
	MFAActivated  bool
	ElevatedUntil *time.Time
}

// AdminSessionByTokenHash resolves a live session to its account and MFA state.
func (s *Store) AdminSessionByTokenHash(ctx context.Context, hash string) (AdminSessionInfo, error) {
	var info AdminSessionInfo
	var activatedAt *time.Time
	err := s.Pool.QueryRow(ctx, `
		SELECT a.id::text, a.email, a.email_verified_at, COALESCE(a.staff_role, ''), a.created_at,
			COALESCE(a.mfa_secret, ''), a.mfa_activated_at, sess.admin_elevated_until
		FROM account_sessions sess
		JOIN accounts a ON a.id = sess.account_id
		WHERE sess.token_hash = $1 AND sess.revoked_at IS NULL AND sess.expires_at > now()`, hash,
	).Scan(
		&info.Account.ID, &info.Account.Email, &info.Account.EmailVerifiedAt,
		&info.Account.StaffRole, &info.Account.CreatedAt,
		&info.MFASecret, &activatedAt, &info.ElevatedUntil,
	)
	if err != nil {
		return AdminSessionInfo{}, mapStoreError("find admin session", err)
	}
	info.MFAActivated = activatedAt != nil
	return info, nil
}

// SetAccountMFASecret stores a fresh (not yet activated) TOTP secret. Re-enrolling
// resets activation so a half-finished enrollment can be restarted.
func (s *Store) SetAccountMFASecret(ctx context.Context, accountID, secret string, audit AuditEvent) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin mfa enroll: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE accounts SET mfa_secret = $2, mfa_activated_at = NULL
		WHERE id = $1::uuid`, accountID, secret); err != nil {
		return mapStoreError("set mfa secret", err)
	}
	audit.ActorType = "account"
	audit.ActorID = accountID
	audit.Action = "admin.mfa_enrolled"
	audit.ResourceType = "account"
	audit.ResourceID = accountID
	audit.Metadata = EmptyAuditMetadata{}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit mfa enroll: %w", err)
	}
	return nil
}

// ActivateAccountMFA marks enrollment complete (first valid code seen). It only
// activates when a secret is present and not already active.
func (s *Store) ActivateAccountMFA(ctx context.Context, accountID string, audit AuditEvent) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin mfa activate: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE accounts SET mfa_activated_at = now()
		WHERE id = $1::uuid AND mfa_secret IS NOT NULL AND mfa_activated_at IS NULL`, accountID)
	if err != nil {
		return mapStoreError("activate mfa", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrConflict
	}
	audit.ActorType = "account"
	audit.ActorID = accountID
	audit.Action = "admin.mfa_activated"
	audit.ResourceType = "account"
	audit.ResourceID = accountID
	audit.Metadata = EmptyAuditMetadata{}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit mfa activate: %w", err)
	}
	return nil
}

// ElevateAdminSession marks the current session step-up elevated until `until`.
func (s *Store) ElevateAdminSession(ctx context.Context, hash string, until time.Time, audit AuditEvent) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin admin elevate: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE account_sessions SET admin_elevated_until = $2
		WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`, hash, until.UTC())
	if err != nil {
		return mapStoreError("elevate admin session", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	audit.Action = "admin.mfa_verified"
	audit.ResourceType = "session"
	audit.Metadata = EmptyAuditMetadata{}
	if err := insertAudit(ctx, tx, audit); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit admin elevate: %w", err)
	}
	return nil
}
