package store

import (
	"context"
	"fmt"
)

type MaintenanceResult struct {
	ComponentSessions int64
	RateLimitBuckets  int64
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
		ComponentSessions: sessions.RowsAffected(), RateLimitBuckets: buckets.RowsAffected(),
	}, nil
}
