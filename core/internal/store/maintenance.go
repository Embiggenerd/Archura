package store

import (
	"context"
	"fmt"
)

type MaintenanceResult struct {
	ComponentSessions  int64
	AccountSessions    int64
	EmailConfirmations int64
	RateLimitBuckets   int64
}

func (s *Store) RunMaintenance(ctx context.Context) (MaintenanceResult, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return MaintenanceResult{}, fmt.Errorf("begin maintenance: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sessions, err := tx.Exec(ctx, `
		DELETE FROM component_sessions
		WHERE expires_at < now() - interval '24 hours'
		   OR revoked_at < now() - interval '24 hours'`)
	if err != nil {
		return MaintenanceResult{}, fmt.Errorf("delete expired component sessions: %w", err)
	}
	accountSessions, err := tx.Exec(ctx, `
		DELETE FROM account_sessions
		WHERE expires_at < now()
		   OR revoked_at IS NOT NULL`)
	if err != nil {
		return MaintenanceResult{}, fmt.Errorf("delete expired account sessions: %w", err)
	}
	confirmations, err := tx.Exec(ctx, `
		DELETE FROM email_confirmations
		WHERE expires_at < now()
		   OR used_at IS NOT NULL`)
	if err != nil {
		return MaintenanceResult{}, fmt.Errorf("delete expired email confirmations: %w", err)
	}
	buckets, err := tx.Exec(ctx, `
		DELETE FROM rate_limit_buckets
		WHERE window_start < now() - interval '24 hours'`)
	if err != nil {
		return MaintenanceResult{}, fmt.Errorf("delete old rate limit buckets: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return MaintenanceResult{}, fmt.Errorf("commit maintenance: %w", err)
	}
	return MaintenanceResult{
		ComponentSessions: sessions.RowsAffected(), AccountSessions: accountSessions.RowsAffected(),
		EmailConfirmations: confirmations.RowsAffected(), RateLimitBuckets: buckets.RowsAffected(),
	}, nil
}
