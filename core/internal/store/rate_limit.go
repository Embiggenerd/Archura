package store

import (
	"context"
	"fmt"
)

// ConsumeRateLimit atomically increments a one-minute fixed window. PostgreSQL
// supplies the window clock so multiple core machines agree on its boundary.
func (s *Store) ConsumeRateLimit(ctx context.Context, subject, operation string, limit int) (RateLimitResult, error) {
	var result RateLimitResult
	err := s.Pool.QueryRow(ctx, `
		WITH current_window AS (
			SELECT date_trunc('minute', now()) AS window_start
		), consumed AS (
			INSERT INTO rate_limit_buckets (subject, operation, window_start, request_count)
			SELECT $1, $2, window_start, 1
			FROM current_window
			ON CONFLICT (subject, operation, window_start)
			DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
			RETURNING request_count, window_start
		)
		SELECT request_count,
			GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + interval '1 minute' - now())))::int)
		FROM consumed`,
		subject, operation,
	).Scan(&result.Count, &result.RetryAfterSeconds)
	if err != nil {
		return RateLimitResult{}, fmt.Errorf("consume rate limit: %w", err)
	}
	result.Allowed = result.Count <= limit
	return result, nil
}
