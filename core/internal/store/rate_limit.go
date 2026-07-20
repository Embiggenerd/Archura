package store

import (
	"context"
	"fmt"
	"time"
)

// ConsumeRateLimit atomically increments a fixed window. PostgreSQL supplies
// the window clock so multiple core machines agree on its boundary.
func (s *Store) ConsumeRateLimit(ctx context.Context, subject, operation string, limit int, window time.Duration) (RateLimitResult, error) {
	windowSeconds := int64(window / time.Second)
	if windowSeconds < 1 || window != time.Duration(windowSeconds)*time.Second {
		return RateLimitResult{}, fmt.Errorf("rate limit window must be a whole positive number of seconds")
	}
	var result RateLimitResult
	err := s.Pool.QueryRow(ctx, `
		WITH current_window AS (
			SELECT date_bin($3 * interval '1 second', now(), TIMESTAMPTZ '1970-01-01') AS window_start
		), consumed AS (
			INSERT INTO rate_limit_buckets (subject, operation, window_start, request_count)
			SELECT $1, $2, window_start, 1
			FROM current_window
			ON CONFLICT (subject, operation, window_start)
			DO UPDATE SET request_count = rate_limit_buckets.request_count + 1
			RETURNING request_count, window_start
		)
		SELECT request_count,
			GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + $3 * interval '1 second' - now())))::int)
		FROM consumed`,
		subject, operation, windowSeconds,
	).Scan(&result.Count, &result.RetryAfterSeconds)
	if err != nil {
		return RateLimitResult{}, fmt.Errorf("consume rate limit: %w", err)
	}
	result.Allowed = result.Count <= limit
	return result, nil
}
