package store

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"
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
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM schema_migrations WHERE version = '0005_namespace_binding'`,
	).Scan(&count); err != nil {
		t.Fatalf("query namespace migration: %v", err)
	}
	if count != 1 {
		t.Fatalf("schema_migrations rows for 0005 = %d, want 1", count)
	}
}

func TestCreateTenantPersistsOptionalEdgeClaimToken(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run store integration tests")
	}
	ctx := context.Background()
	st, err := Open(ctx, url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var tenantIDs []string
	defer func() {
		for _, tenantID := range tenantIDs {
			_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE tenant_id = $1::uuid`, tenantID)
			_, _ = st.Pool.Exec(ctx, `DELETE FROM tenants WHERE id = $1::uuid`, tenantID)
		}
	}()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	bound, err := st.CreateTenant(ctx, CreateTenantParams{
		Name: "Bound Test Client", Slug: "bound-" + suffix,
		PublishableKey: "pk_test_" + suffix, SecretKeyHash: "secret-hash-" + suffix,
		AllowedOrigins: []string{"http://localhost:5173"}, EdgeClaimToken: "edge-token-" + suffix,
	}, AuditEvent{
		ActorType: "platform_admin", Action: "client.created", ResourceType: "client",
		RequestID: "test-bound-" + suffix, Metadata: ClientAuditMetadata{NamespaceBound: true},
	})
	if err != nil {
		t.Fatalf("create bound tenant: %v", err)
	}
	tenantIDs = append(tenantIDs, bound.ID)
	unbound, err := st.CreateTenant(ctx, CreateTenantParams{
		Name: "Unbound Test Client", Slug: "unbound-" + suffix,
		PublishableKey: "pk_test_unbound_" + suffix, SecretKeyHash: "secret-hash-unbound-" + suffix,
		AllowedOrigins: []string{"http://localhost:5173"},
	}, AuditEvent{
		ActorType: "platform_admin", Action: "client.created", ResourceType: "client",
		RequestID: "test-unbound-" + suffix, Metadata: ClientAuditMetadata{NamespaceBound: false},
	})
	if err != nil {
		t.Fatalf("create unbound tenant: %v", err)
	}
	tenantIDs = append(tenantIDs, unbound.ID)

	var storedToken *string
	if err := st.Pool.QueryRow(ctx, `SELECT edge_claim_token FROM tenants WHERE id = $1::uuid`, bound.ID).Scan(&storedToken); err != nil {
		t.Fatalf("query bound token: %v", err)
	}
	if storedToken == nil || *storedToken != "edge-token-"+suffix {
		t.Fatalf("stored bound token = %v", storedToken)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT edge_claim_token FROM tenants WHERE id = $1::uuid`, unbound.ID).Scan(&storedToken); err != nil {
		t.Fatalf("query unbound token: %v", err)
	}
	if storedToken != nil {
		t.Fatalf("stored unbound token = %q, want NULL", *storedToken)
	}
}
