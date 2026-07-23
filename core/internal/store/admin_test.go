package store

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestDefaultFreePlanCopiesWithoutInheritance(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "admin-default-" + suffix
	original, err := st.DefaultFreePlan(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var organizationIDs []string
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
		for _, id := range organizationIDs {
			_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE organization_id = $1::uuid`, id)
			_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, id)
		}
		_, _ = st.Pool.Exec(ctx, `
			UPDATE default_free_plan
			SET trial_days = $1, free_design_limit = $2, free_site_limit = $3,
				free_no_expiry = $4, updated_at = $5
			WHERE singleton`, original.TrialDays, original.FreeDesignLimit,
			original.FreeSiteLimit, original.FreeNoExpiry, original.UpdatedAt)
	})

	trial2 := 2
	if _, err := st.UpdateDefaultFreePlan(ctx, FreePlanPatch{TrialDays: &trial2}, AuditEvent{
		ActorType: "account", ActorID: "test-owner", RequestID: requestPrefix + "-set-2",
	}); err != nil {
		t.Fatal(err)
	}
	first := createAdminTestOrganization(t, ctx, st, suffix+"-first", requestPrefix+"-first")
	organizationIDs = append(organizationIDs, first.ID)

	trial30 := 30
	if _, err := st.UpdateDefaultFreePlan(ctx, FreePlanPatch{TrialDays: &trial30}, AuditEvent{
		ActorType: "account", ActorID: "test-owner", RequestID: requestPrefix + "-set-30",
	}); err != nil {
		t.Fatal(err)
	}
	firstBilling, err := st.BillingForOrganization(ctx, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if firstBilling.FreeTrialDays != 2 {
		t.Fatalf("first organization trial days = %d, want 2", firstBilling.FreeTrialDays)
	}
	startedAt := time.Now().UTC()
	firstBilling, err = st.StartOrganizationTrial(ctx, first.ID, startedAt, AuditEvent{
		ActorType: "account", ActorID: "test-owner", RequestID: requestPrefix + "-start-trial",
		Metadata: EmptyAuditMetadata{},
	})
	if err != nil || firstBilling.TrialStartedAt == nil {
		t.Fatalf("start trial billing=%+v err=%v", firstBilling, err)
	}
	if err := st.SetStripeCustomer(ctx, first.ID, "cus_"+suffix); err != nil {
		t.Fatalf("set Stripe customer on guaranteed row: %v", err)
	}
	second := createAdminTestOrganization(t, ctx, st, suffix+"-second", requestPrefix+"-second")
	organizationIDs = append(organizationIDs, second.ID)
	secondBilling, err := st.BillingForOrganization(ctx, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if secondBilling.FreeTrialDays != 30 {
		t.Fatalf("second organization trial days = %d, want 30", secondBilling.FreeTrialDays)
	}
}

func TestForkLifecycleAndWorkspaceBootstrap(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "admin-fork-" + suffix
	accountEmail := "platform-" + suffix + "@example.com"
	var accountID string
	if err := st.Pool.QueryRow(ctx, `
		INSERT INTO accounts (email, email_verified_at)
		VALUES ($1, now()) RETURNING id::text`, accountEmail).Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	source := createAdminTestOrganization(t, ctx, st, suffix+"-source", requestPrefix+"-source")
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
		_, _ = st.Pool.Exec(ctx, `DELETE FROM designs WHERE forked_by = $1`, accountID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM accounts WHERE id = $1::uuid`, accountID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, source.ID)
	})

	workspace, err := st.BootstrapPlatformWorkspace(ctx, CreateOrganizationParams{
		PublishableKey: "pk_test_workspace_" + suffix,
		SecretKeyHash:  "workspace-secret-" + suffix,
	}, AuditEvent{ActorType: "internal", ActorID: "admin_cli", RequestID: requestPrefix + "-bootstrap"})
	if err != nil {
		t.Fatal(err)
	}
	if !workspace.CapsExempt || !workspace.IsPlatformWorkspace {
		t.Fatalf("workspace flags = %+v", workspace)
	}
	falseValue := false
	if _, err := st.UpdateOrganizationFreePlan(ctx, workspace.ID, OrganizationFreePlanPatch{
		FreeNoExpiry: &falseValue, Reason: "Should be rejected",
	}, AuditEvent{ActorType: "account", ActorID: accountID, RequestID: requestPrefix + "-expire-workspace"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("workspace expiration error = %v", err)
	}
	if _, err := st.GrantStaff(ctx, accountID, AuditEvent{
		ActorType: "internal", ActorID: "admin_cli", RequestID: requestPrefix + "-grant",
	}); err != nil {
		t.Fatal(err)
	}
	design, err := st.CreateDesign(ctx, source.ID, "Source", "pages/Landing", AuditEvent{
		ActorType: "account", ActorID: accountID, RequestID: requestPrefix + "-design", Metadata: EmptyAuditMetadata{},
	})
	if err != nil {
		t.Fatal(err)
	}
	fork, err := st.CreateFork(ctx, design.ID, "fork-key-"+suffix, accountID, AuditEvent{
		ActorType: "account", ActorID: accountID, RequestID: requestPrefix + "-create-fork",
	})
	if err != nil || fork.ForkStatus != "pending" || fork.OrganizationID != workspace.ID {
		t.Fatalf("created fork = %+v, err=%v", fork, err)
	}
	retry, err := st.CreateFork(ctx, design.ID, "fork-key-"+suffix, accountID, AuditEvent{})
	if err != nil || retry.ID != fork.ID {
		t.Fatalf("fork retry = %+v, err=%v", retry, err)
	}
	ready := ForkFinalize{Status: "ready", SourceArtifactKind: "published", SourceETag: "etag-1"}
	finalized, err := st.FinalizeFork(ctx, fork.ID, ready, AuditEvent{
		ActorType: "account", ActorID: accountID, RequestID: requestPrefix + "-finalize",
	})
	if err != nil || finalized.ForkStatus != "ready" || finalized.SourceArtifactETag != "etag-1" {
		t.Fatalf("finalized fork = %+v, err=%v", finalized, err)
	}
	if _, err := st.FinalizeFork(ctx, fork.ID, ready, AuditEvent{}); err != nil {
		t.Fatalf("identical finalize retry: %v", err)
	}
	_, err = st.FinalizeFork(ctx, fork.ID, ForkFinalize{
		Status: "ready", SourceArtifactKind: "published", SourceETag: "etag-2",
	}, AuditEvent{})
	if !errors.Is(err, ErrInvalidState) {
		t.Fatalf("conflicting ready finalize error = %v", err)
	}
	if _, err := st.FinalizeFork(ctx, design.ID, ready, AuditEvent{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-fork finalize error = %v", err)
	}
}

func TestRowLockedDesignCap(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "admin-cap-" + suffix
	organization := createAdminTestOrganization(t, ctx, st, suffix+"-cap", requestPrefix+"-organization")
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE organization_id = $1::uuid`, organization.ID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
	})
	one := 1
	if _, err := st.UpdateOrganizationFreePlan(ctx, organization.ID, OrganizationFreePlanPatch{
		FreeDesignLimit: &one, Reason: "Concurrency test",
	}, AuditEvent{ActorType: "account", ActorID: "test-owner", RequestID: requestPrefix + "-limit"}); err != nil {
		t.Fatal(err)
	}

	results := make(chan error, 2)
	var start sync.WaitGroup
	start.Add(1)
	for i := 0; i < 2; i++ {
		go func(index int) {
			start.Wait()
			_, err := st.CreateDesign(ctx, organization.ID, fmt.Sprintf("Design %d", index),
				"pages/Landing", AuditEvent{
					ActorType: "account", ActorID: "test-account",
					RequestID: fmt.Sprintf("%s-create-%d", requestPrefix, index), Metadata: EmptyAuditMetadata{},
				})
			results <- err
		}(i)
	}
	start.Done()
	var successes, limited int
	for i := 0; i < 2; i++ {
		err := <-results
		switch {
		case err == nil:
			successes++
		case errors.Is(err, ErrLimitReached):
			limited++
		default:
			t.Fatalf("unexpected create error: %v", err)
		}
	}
	if successes != 1 || limited != 1 {
		t.Fatalf("successes=%d limited=%d, want 1/1", successes, limited)
	}
	if _, err := st.Pool.Exec(ctx, `
		UPDATE organization_billing
		SET trial_started_at = now() - interval '2 days',
			trial_ends_at = now() - interval '1 day',
			serve_grace_ends_at = now() - interval '1 day'
		WHERE organization_id = $1::uuid`, organization.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateDesign(ctx, organization.ID, "Expired", "pages/Landing", AuditEvent{
		ActorType: "account", ActorID: "test-account", RequestID: requestPrefix + "-expired",
		Metadata: EmptyAuditMetadata{},
	}); !errors.Is(err, ErrReadOnly) {
		t.Fatalf("expired organization create error = %v", err)
	}
}

func TestSiteCapUsesFreeAndPaidLimits(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "admin-site-cap-" + suffix
	organization := createAdminTestOrganization(t, ctx, st, suffix+"-site-cap", requestPrefix+"-organization")
	var accountID string
	if err := st.Pool.QueryRow(ctx, `
		INSERT INTO accounts (email, email_verified_at)
		VALUES ($1, now()) RETURNING id::text`, "site-cap-"+suffix+"@example.com").Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO organization_memberships (account_id, organization_id, role)
		VALUES ($1::uuid, $2::uuid, 'owner')`, accountID, organization.ID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE organization_id = $1::uuid`, organization.ID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM accounts WHERE id = $1::uuid`, accountID)
	})
	audit := func(id string) AuditEvent {
		return AuditEvent{
			ActorType: "account", ActorID: accountID, Action: "site_ownership.bound",
			ResourceType: "site", ResourceID: id, RequestID: requestPrefix + "-" + id,
			Metadata: EmptyAuditMetadata{},
		}
	}
	if err := st.BindOrganizationSite(ctx, "free-one-"+suffix, organization.ID, accountID, audit("free-one")); err != nil {
		t.Fatal(err)
	}
	if err := st.BindOrganizationSite(ctx, "free-two-"+suffix, organization.ID, accountID, audit("free-two")); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("second free site error = %v", err)
	}
	if _, err := st.Pool.Exec(ctx, `
		UPDATE organization_billing
		SET stripe_subscription_status = 'active', updated_at = now()
		WHERE organization_id = $1::uuid`, organization.ID); err != nil {
		t.Fatal(err)
	}
	if err := st.BindOrganizationSite(ctx, "paid-two-"+suffix, organization.ID, accountID, audit("paid-two")); err != nil {
		t.Fatalf("second paid site: %v", err)
	}
	if err := st.BindOrganizationSite(ctx, "paid-three-"+suffix, organization.ID, accountID, audit("paid-three")); err != nil {
		t.Fatalf("third paid site: %v", err)
	}
	if err := st.BindOrganizationSite(ctx, "paid-four-"+suffix, organization.ID, accountID, audit("paid-four")); !errors.Is(err, ErrLimitReached) {
		t.Fatalf("fourth paid site error = %v", err)
	}
}

func TestConcurrentSiteBindHasSingleOwner(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "site-bind-race-" + suffix
	subdomain := "concurrent-site-" + suffix

	organizations := []Organization{
		createAdminTestOrganization(t, ctx, st, suffix+"-site-race-a", requestPrefix+"-organization-a"),
		createAdminTestOrganization(t, ctx, st, suffix+"-site-race-b", requestPrefix+"-organization-b"),
	}
	accountIDs := make([]string, len(organizations))
	for i, organization := range organizations {
		if err := st.Pool.QueryRow(ctx, `
			INSERT INTO accounts (email, email_verified_at)
			VALUES ($1, now()) RETURNING id::text`,
			fmt.Sprintf("site-bind-race-%d-%s@example.com", i, suffix),
		).Scan(&accountIDs[i]); err != nil {
			t.Fatal(err)
		}
		if _, err := st.Pool.Exec(ctx, `
			INSERT INTO organization_memberships (account_id, organization_id, role)
			VALUES ($1::uuid, $2::uuid, 'owner')`,
			accountIDs[i], organization.ID,
		); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
		for _, organization := range organizations {
			_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
		}
		for _, accountID := range accountIDs {
			_, _ = st.Pool.Exec(ctx, `DELETE FROM accounts WHERE id = $1::uuid`, accountID)
		}
	})

	type bindResult struct {
		organizationID string
		err            error
	}
	start := make(chan struct{})
	results := make(chan bindResult, len(organizations))
	var ready sync.WaitGroup
	ready.Add(len(organizations))
	for i, organization := range organizations {
		go func(accountID string, organization Organization) {
			ready.Done()
			<-start
			err := st.BindOrganizationSite(ctx, subdomain, organization.ID, accountID, AuditEvent{
				ActorType: "account", ActorID: accountID, Action: "site_ownership.bound",
				ResourceType: "site", ResourceID: subdomain,
				RequestID: requestPrefix + "-" + organization.ID, Metadata: EmptyAuditMetadata{},
			})
			results <- bindResult{organizationID: organization.ID, err: err}
		}(accountIDs[i], organization)
	}
	ready.Wait()
	close(start)

	var winnerID string
	conflicts := 0
	for range organizations {
		result := <-results
		switch {
		case result.err == nil:
			if winnerID != "" {
				t.Fatalf("both organizations bound subdomain %q", subdomain)
			}
			winnerID = result.organizationID
		case errors.Is(result.err, ErrConflict):
			conflicts++
		default:
			t.Fatalf("bind organization %s: %v", result.organizationID, result.err)
		}
	}
	if winnerID == "" || conflicts != 1 {
		t.Fatalf("winner = %q, conflicts = %d; want one winner and one conflict", winnerID, conflicts)
	}

	boundOrganizationID, bound, err := st.SiteBinding(ctx, subdomain)
	if err != nil {
		t.Fatal(err)
	}
	if !bound || boundOrganizationID != winnerID {
		t.Fatalf("binding = (%q, %t), want (%q, true)", boundOrganizationID, bound, winnerID)
	}
	var bindingCount, auditCount int
	if err := st.Pool.QueryRow(ctx,
		`SELECT count(*) FROM organization_sites WHERE subdomain = $1`, subdomain,
	).Scan(&bindingCount); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `
		SELECT count(*) FROM audit_log
		WHERE request_id LIKE $1 AND action = 'site_ownership.bound'`,
		requestPrefix+"%",
	).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if bindingCount != 1 || auditCount != 1 {
		t.Fatalf("binding rows = %d, successful bind audits = %d; want 1 each", bindingCount, auditCount)
	}
}

func TestAdminOrganizationsSearchByOwnerEmail(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "admin-search-" + suffix
	organization := createAdminTestOrganization(t, ctx, st, suffix, requestPrefix)

	// A member whose email is the only searchable handle for this org.
	email := "search-owner-" + suffix + "@example.com"
	var accountID string
	if err := st.Pool.QueryRow(ctx, `
		INSERT INTO accounts (email, email_verified_at)
		VALUES ($1, now()) RETURNING id::text`, email).Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO organization_memberships (organization_id, account_id, role)
		VALUES ($1::uuid, $2::uuid, 'owner')`, organization.ID, accountID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organization_memberships WHERE account_id = $1::uuid`, accountID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM accounts WHERE id = $1::uuid`, accountID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
	})

	page, err := st.AdminOrganizations(ctx, "search-owner-"+suffix, 25, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range page.Items {
		if item.ID == organization.ID {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected org %s to be found by owner email fragment", organization.ID)
	}
}

func createAdminTestOrganization(t *testing.T, ctx context.Context, st *Store, suffix, requestID string) Organization {
	t.Helper()
	organization, err := st.CreateOrganization(ctx, CreateOrganizationParams{
		Name: "Admin Test " + suffix, Slug: "admin-test-" + suffix,
		PublishableKey: "pk_test_" + suffix, SecretKeyHash: "secret-" + suffix,
		AllowedOrigins: []string{},
	}, AuditEvent{
		ActorType: "platform_admin", Action: "organization.created", ResourceType: "organization",
		RequestID: requestID, Metadata: OrganizationAuditMetadata{},
	})
	if err != nil {
		t.Fatal(err)
	}
	return organization
}
