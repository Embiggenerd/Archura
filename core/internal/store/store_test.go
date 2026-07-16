package store

import (
	"context"
	"os"
	"testing"
)

// Set TEST_DATABASE_URL to run against a real Postgres; otherwise skipped.
func TestMigrateIdempotent(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run migration tests")
	}
	ctx := context.Background()
	st, err := Open(ctx, url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()

	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	// Running again must be a no-op, not an error.
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("second migrate (should be idempotent): %v", err)
	}

	var count int
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM schema_migrations WHERE version = '0001_tenants'`,
	).Scan(&count); err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	if count != 1 {
		t.Fatalf("schema_migrations rows for 0001 = %d, want 1", count)
	}
}
