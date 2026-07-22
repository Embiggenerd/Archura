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
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM schema_migrations WHERE version = '0006_accounts'`,
	).Scan(&count); err != nil {
		t.Fatalf("query accounts migration: %v", err)
	}
	if count != 1 {
		t.Fatalf("schema_migrations rows for 0006 = %d, want 1", count)
	}
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM schema_migrations WHERE version = '0012_admin_console'`,
	).Scan(&count); err != nil {
		t.Fatalf("query admin-console migration: %v", err)
	}
	if count != 1 {
		t.Fatalf("schema_migrations rows for 0012 = %d, want 1", count)
	}
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM schema_migrations WHERE version = '0016_admin_deletions'`,
	).Scan(&count); err != nil {
		t.Fatalf("query admin-deletions migration: %v", err)
	}
	if count != 1 {
		t.Fatalf("schema_migrations rows for 0016 = %d, want 1", count)
	}
	if err := st.Pool.QueryRow(ctx, `
		SELECT count(*)
		FROM organizations o
		LEFT JOIN organization_billing b ON b.organization_id = o.id
		WHERE b.organization_id IS NULL`,
	).Scan(&count); err != nil {
		t.Fatalf("query organization billing invariant: %v", err)
	}
	if count != 0 {
		t.Fatalf("organizations without billing rows = %d, want 0", count)
	}
	if err := st.RecordAudit(ctx, AuditEvent{
		ActorType: "anonymous", Action: "confirmation.verify_rejected",
		ResourceType: "confirmation", Outcome: "rejected", RequestID: "migration-audit-test",
		Metadata: EmptyAuditMetadata{},
	}); err != nil {
		t.Fatalf("insert rejected confirmation audit: %v", err)
	}
	_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id = 'migration-audit-test'`)
}

func TestCreateOrganizationPersistsOptionalEdgeClaimToken(t *testing.T) {
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
	var organizationIDs []string
	defer func() {
		for _, organizationID := range organizationIDs {
			_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE organization_id = $1::uuid`, organizationID)
			_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organizationID)
		}
	}()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	bound, err := st.CreateOrganization(ctx, CreateOrganizationParams{
		Name: "Bound Test Client", Slug: "bound-" + suffix,
		PublishableKey: "pk_test_" + suffix, SecretKeyHash: "secret-hash-" + suffix,
		AllowedOrigins: []string{"http://localhost:5173"}, EdgeClaimToken: "edge-token-" + suffix,
	}, AuditEvent{
		ActorType: "platform_admin", Action: "organization.created", ResourceType: "organization",
		RequestID: "test-bound-" + suffix, Metadata: ClientAuditMetadata{NamespaceBound: true},
	})
	if err != nil {
		t.Fatalf("create bound organization: %v", err)
	}
	organizationIDs = append(organizationIDs, bound.ID)
	unbound, err := st.CreateOrganization(ctx, CreateOrganizationParams{
		Name: "Unbound Test Client", Slug: "unbound-" + suffix,
		PublishableKey: "pk_test_unbound_" + suffix, SecretKeyHash: "secret-hash-unbound-" + suffix,
		AllowedOrigins: []string{"http://localhost:5173"},
	}, AuditEvent{
		ActorType: "platform_admin", Action: "organization.created", ResourceType: "organization",
		RequestID: "test-unbound-" + suffix, Metadata: ClientAuditMetadata{NamespaceBound: false},
	})
	if err != nil {
		t.Fatalf("create unbound organization: %v", err)
	}
	organizationIDs = append(organizationIDs, unbound.ID)

	var storedToken *string
	if err := st.Pool.QueryRow(ctx, `SELECT edge_claim_token FROM organizations WHERE id = $1::uuid`, bound.ID).Scan(&storedToken); err != nil {
		t.Fatalf("query bound token: %v", err)
	}
	if storedToken == nil || *storedToken != "edge-token-"+suffix {
		t.Fatalf("stored bound token = %v", storedToken)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT edge_claim_token FROM organizations WHERE id = $1::uuid`, unbound.ID).Scan(&storedToken); err != nil {
		t.Fatalf("query unbound token: %v", err)
	}
	if storedToken != nil {
		t.Fatalf("stored unbound token = %q, want NULL", *storedToken)
	}
}
