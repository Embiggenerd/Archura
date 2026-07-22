package store

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestDeleteOrganizationPreservesAuditAndReleasesBindings(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	createRequestID := "admin-delete-org-create-" + suffix
	deleteRequestID := "admin-delete-org-delete-" + suffix
	organization := createAdminTestOrganization(t, ctx, st, suffix, createRequestID)
	subdomain := "admin-delete-" + suffix
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id IN ($1, $2)`, createRequestID, deleteRequestID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
	})
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO organization_sites (subdomain, organization_id) VALUES ($1, $2::uuid)`,
		subdomain, organization.ID,
	); err != nil {
		t.Fatal(err)
	}

	exists, err := st.OrganizationExists(ctx, organization.ID)
	if err != nil || !exists {
		t.Fatalf("organization existence before delete = %v, err=%v", exists, err)
	}
	boundOrganizationID, bound, err := st.SiteBinding(ctx, subdomain)
	if err != nil || !bound || boundOrganizationID != organization.ID {
		t.Fatalf("binding before delete = %q/%v, err=%v", boundOrganizationID, bound, err)
	}

	result, err := st.DeleteOrganization(ctx, organization.ID, deletionTestAudit(deleteRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.ReleasedSites) != 1 || result.ReleasedSites[0] != subdomain {
		t.Fatalf("released sites = %#v", result.ReleasedSites)
	}
	exists, err = st.OrganizationExists(ctx, organization.ID)
	if err != nil || exists {
		t.Fatalf("organization existence after delete = %v, err=%v", exists, err)
	}
	if _, bound, err := st.SiteBinding(ctx, subdomain); err != nil || bound {
		t.Fatalf("binding after delete = %v, err=%v", bound, err)
	}

	var historicalDetached bool
	if err := st.Pool.QueryRow(ctx, `
		SELECT organization_id IS NULL FROM audit_log
		WHERE request_id = $1 AND action = 'organization.created'`, createRequestID,
	).Scan(&historicalDetached); err != nil || !historicalDetached {
		t.Fatalf("historical audit detached = %v, err=%v", historicalDetached, err)
	}
	var deletionDetached bool
	var resourceID, slug string
	if err := st.Pool.QueryRow(ctx, `
		SELECT organization_id IS NULL, resource_id, metadata->>'slug'
		FROM audit_log WHERE request_id = $1 AND action = 'admin.organization_deleted'`, deleteRequestID,
	).Scan(&deletionDetached, &resourceID, &slug); err != nil {
		t.Fatal(err)
	}
	if !deletionDetached || resourceID != organization.ID || slug != organization.Slug {
		t.Fatalf("deletion audit detached=%v resource=%q slug=%q", deletionDetached, resourceID, slug)
	}
}

func TestDeleteOrganizationGuardsNullSubscriptionStatus(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "admin-delete-null-subscription-" + suffix
	organization := createAdminTestOrganization(t, ctx, st, suffix, requestPrefix+"-create")
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
	})
	if _, err := st.Pool.Exec(ctx, `
		UPDATE organization_billing
		SET stripe_subscription_id = $2, stripe_subscription_status = NULL
		WHERE organization_id = $1::uuid`, organization.ID, "sub_null_"+suffix,
	); err != nil {
		t.Fatal(err)
	}

	_, err := st.DeleteOrganization(ctx, organization.ID, deletionTestAudit(requestPrefix+"-delete"))
	var blocked *AdminDeleteBlocked
	if !errors.As(err, &blocked) || blocked.Code != "subscription_active" || blocked.OrganizationID != organization.ID {
		t.Fatalf("delete error = %#v", err)
	}
	exists, existsErr := st.OrganizationExists(ctx, organization.ID)
	if existsErr != nil || !exists {
		t.Fatalf("blocked organization existence = %v, err=%v", exists, existsErr)
	}
}

func TestDeleteOrganizationAndBillingUpdateLockOrder(t *testing.T) {
	t.Run("delete locks billing before organization", func(t *testing.T) {
		st := openTestStore(t)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		suffix := fmt.Sprintf("%d", time.Now().UnixNano())
		requestPrefix := "admin-delete-first-" + suffix
		organization := createAdminTestOrganization(t, ctx, st, suffix, requestPrefix+"-create")
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
			_, _ = st.Pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
		})

		blocker, err := st.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = blocker.Rollback(context.Background()) }()
		if _, err := blocker.Exec(ctx, `SELECT id FROM organizations WHERE id = $1::uuid FOR UPDATE`, organization.ID); err != nil {
			t.Fatal(err)
		}

		deleteDone := make(chan error, 1)
		go func() {
			_, err := st.DeleteOrganization(ctx, organization.ID, deletionTestAudit(requestPrefix+"-delete"))
			deleteDone <- err
		}()
		waitForAdminDeleteRowLock(t, ctx, st, `
			SELECT organization_id::text FROM organization_billing
			WHERE organization_id = $1::uuid FOR UPDATE NOWAIT`, organization.ID)

		billingDone := make(chan error, 1)
		go func() {
			billingDone <- st.UpdateStripeSubscription(ctx, StripeSubscriptionUpdate{
				OrganizationID: organization.ID, CustomerID: "cus_" + suffix,
				SubscriptionID: "sub_" + suffix, Status: "active", EventCreatedAt: time.Now().UTC(),
			}, AuditEvent{
				ActorType: "internal", ActorID: "stripe", RequestID: requestPrefix + "-webhook",
				Metadata: EmptyAuditMetadata{},
			})
		}()
		if err := blocker.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := <-deleteDone; err != nil {
			t.Fatalf("delete result: %v", err)
		}
		if err := <-billingDone; err != nil {
			t.Fatalf("billing result after delete: %v", err)
		}
		exists, err := st.OrganizationExists(ctx, organization.ID)
		if err != nil || exists {
			t.Fatalf("organization after delete-first ordering = %v, err=%v", exists, err)
		}
	})

	t.Run("billing update commits before delete guard", func(t *testing.T) {
		st := openTestStore(t)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		suffix := fmt.Sprintf("%d", time.Now().UnixNano())
		requestPrefix := "admin-webhook-first-" + suffix
		organization := createAdminTestOrganization(t, ctx, st, suffix, requestPrefix+"-create")
		t.Cleanup(func() {
			_, _ = st.Pool.Exec(context.Background(), `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
			_, _ = st.Pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
		})

		webhook, err := st.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = webhook.Rollback(context.Background()) }()
		if _, err := webhook.Exec(ctx, `
			UPDATE organization_billing
			SET stripe_subscription_id = $2, stripe_subscription_status = 'active'
			WHERE organization_id = $1::uuid`, organization.ID, "sub_"+suffix,
		); err != nil {
			t.Fatal(err)
		}
		deleteDone := make(chan error, 1)
		go func() {
			_, err := st.DeleteOrganization(ctx, organization.ID, deletionTestAudit(requestPrefix+"-delete"))
			deleteDone <- err
		}()
		select {
		case err := <-deleteDone:
			t.Fatalf("delete did not wait for billing update: %v", err)
		case <-time.After(50 * time.Millisecond):
		}
		if err := webhook.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		err = <-deleteDone
		var blocked *AdminDeleteBlocked
		if !errors.As(err, &blocked) || blocked.Code != "subscription_active" {
			t.Fatalf("delete after active billing update = %#v", err)
		}
	})
}

func TestOrganizationExistsDoesNotDependOnBillingRow(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestID := "admin-exists-no-billing-" + suffix
	organization := createAdminTestOrganization(t, ctx, st, suffix, requestID)
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id = $1`, requestID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
	})
	if _, err := st.Pool.Exec(ctx, `DELETE FROM organization_billing WHERE organization_id = $1::uuid`, organization.ID); err != nil {
		t.Fatal(err)
	}
	exists, err := st.OrganizationExists(ctx, organization.ID)
	if err != nil || !exists {
		t.Fatalf("organization without billing existence = %v, err=%v", exists, err)
	}
}

func TestDeleteAccountIsAtomicAndCleansEmailArtifacts(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "admin-delete-account-" + suffix
	email := "test+" + suffix + "@example.com"
	otherEmail := "coowner+" + suffix + "@example.com"
	accountID := insertAdminDeleteTestAccount(t, ctx, st, email)
	otherAccountID := insertAdminDeleteTestAccount(t, ctx, st, otherEmail)
	soleOrganization := createAdminTestOrganization(t, ctx, st, suffix+"-sole", requestPrefix+"-sole")
	sharedOrganization := createAdminTestOrganization(t, ctx, st, suffix+"-shared", requestPrefix+"-shared")
	soleSite := "sole-site-" + suffix
	t.Cleanup(func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
		_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE id IN ($1::uuid, $2::uuid)`, soleOrganization.ID, sharedOrganization.ID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM accounts WHERE id IN ($1::uuid, $2::uuid)`, accountID, otherAccountID)
		_, _ = st.Pool.Exec(ctx, `DELETE FROM email_confirmations WHERE email = $1`, email)
	})
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO organization_memberships (account_id, organization_id, role) VALUES
			($1::uuid, $3::uuid, 'owner'),
			($1::uuid, $4::uuid, 'owner'),
			($2::uuid, $4::uuid, 'member')`,
		accountID, otherAccountID, soleOrganization.ID, sharedOrganization.ID,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO organization_sites (subdomain, organization_id) VALUES ($1, $2::uuid)`,
		soleSite, soleOrganization.ID,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO organization_invitations (organization_id, email, status, expires_at) VALUES
			($1::uuid, $2, 'pending', now() + interval '1 day'),
			($1::uuid, $2, 'accepted', now() + interval '1 day')`,
		sharedOrganization.ID, email,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO email_confirmations (token_hash, email, expires_at)
		VALUES ($1, $2, now() + interval '1 day')`,
		"admin-delete-confirmation-"+suffix, email,
	); err != nil {
		t.Fatal(err)
	}
	detail, err := st.AdminAccountByID(ctx, accountID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Email != email || detail.MembershipCount != 2 || len(detail.Memberships) != 2 {
		t.Fatalf("account detail = %+v", detail)
	}
	classifications := make(map[string]AdminAccountMembership, len(detail.Memberships))
	for _, membership := range detail.Memberships {
		classifications[membership.OrganizationID] = membership
	}
	sole := classifications[soleOrganization.ID]
	shared := classifications[sharedOrganization.ID]
	if !sole.SoleMember || sole.LastOwner || len(sole.Sites) != 1 || sole.Sites[0] != soleSite {
		t.Fatalf("sole membership preview = %+v", sole)
	}
	if shared.SoleMember || !shared.LastOwner {
		t.Fatalf("shared membership preview = %+v", shared)
	}
	page, err := st.AdminAccounts(ctx, email, 25, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != accountID || page.Items[0].Email != email {
		t.Fatalf("account search page = %+v", page)
	}

	_, err = st.DeleteAccount(ctx, accountID, deletionTestAudit(requestPrefix+"-blocked"))
	var blocked *AdminDeleteBlocked
	if !errors.As(err, &blocked) || blocked.Code != "last_owner" || blocked.OrganizationID != sharedOrganization.ID {
		t.Fatalf("last-owner delete error = %#v", err)
	}
	for name, query := range map[string]string{
		"account":            `SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1::uuid)`,
		"sole organization":  `SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1::uuid)`,
		"pending invitation": `SELECT EXISTS(SELECT 1 FROM organization_invitations WHERE email = $1 AND status = 'pending')`,
		"confirmation":       `SELECT EXISTS(SELECT 1 FROM email_confirmations WHERE email = $1)`,
	} {
		argument := any(accountID)
		if name == "sole organization" {
			argument = soleOrganization.ID
		} else if name == "pending invitation" || name == "confirmation" {
			argument = email
		}
		var exists bool
		if err := st.Pool.QueryRow(ctx, query, argument).Scan(&exists); err != nil || !exists {
			t.Fatalf("%s rolled back = %v, err=%v", name, exists, err)
		}
	}

	if _, err := st.Pool.Exec(ctx, `
		UPDATE organization_memberships SET role = 'owner'
		WHERE account_id = $1::uuid AND organization_id = $2::uuid`, otherAccountID, sharedOrganization.ID,
	); err != nil {
		t.Fatal(err)
	}
	result, err := st.DeleteAccount(ctx, accountID, deletionTestAudit(requestPrefix+"-delete"))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.DeletedOrganizationIDs) != 1 || result.DeletedOrganizationIDs[0] != soleOrganization.ID {
		t.Fatalf("deleted organizations = %#v", result.DeletedOrganizationIDs)
	}
	if len(result.ReleasedSites) != 1 || result.ReleasedSites[0] != soleSite {
		t.Fatalf("released sites = %#v", result.ReleasedSites)
	}

	var accountExists, soleExists, sharedExists bool
	if err := st.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts WHERE id = $1::uuid)`, accountID).Scan(&accountExists); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1::uuid)`, soleOrganization.ID).Scan(&soleExists); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1::uuid)`, sharedOrganization.ID).Scan(&sharedExists); err != nil {
		t.Fatal(err)
	}
	if accountExists || soleExists || !sharedExists {
		t.Fatalf("post-delete account=%v sole=%v shared=%v", accountExists, soleExists, sharedExists)
	}
	var pendingCount, acceptedCount, confirmationCount int
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM organization_invitations WHERE email = $1 AND status = 'pending'`, email).Scan(&pendingCount); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM organization_invitations WHERE email = $1 AND status = 'accepted'`, email).Scan(&acceptedCount); err != nil {
		t.Fatal(err)
	}
	if err := st.Pool.QueryRow(ctx, `SELECT count(*) FROM email_confirmations WHERE email = $1`, email).Scan(&confirmationCount); err != nil {
		t.Fatal(err)
	}
	if pendingCount != 0 || acceptedCount != 1 || confirmationCount != 0 {
		t.Fatalf("email artifacts pending=%d accepted=%d confirmations=%d", pendingCount, acceptedCount, confirmationCount)
	}
	var accountAuditCount, organizationAuditCount int
	if err := st.Pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE action = 'admin.account_deleted'),
			count(*) FILTER (WHERE action = 'admin.organization_deleted')
		FROM audit_log WHERE request_id = $1`, requestPrefix+"-delete",
	).Scan(&accountAuditCount, &organizationAuditCount); err != nil {
		t.Fatal(err)
	}
	if accountAuditCount != 1 || organizationAuditCount != 1 {
		t.Fatalf("deletion audits account=%d organization=%d", accountAuditCount, organizationAuditCount)
	}
}

func TestInvitationAcceptanceAndAccountDeleteShareLockOrder(t *testing.T) {
	for _, acceptanceFirst := range []bool{true, false} {
		name := "delete first"
		if acceptanceFirst {
			name = "acceptance first"
		}
		t.Run(name, func(t *testing.T) {
			st := openTestStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			suffix := fmt.Sprintf("%d", time.Now().UnixNano())
			requestPrefix := "admin-invitation-order-" + suffix
			email := "invite-order+" + suffix + "@example.com"
			ownerID := insertAdminDeleteTestAccount(t, ctx, st, "invite-owner+"+suffix+"@example.com")
			accountID := insertAdminDeleteTestAccount(t, ctx, st, email)
			organization := createAdminTestOrganization(t, ctx, st, suffix, requestPrefix+"-create")
			t.Cleanup(func() {
				_, _ = st.Pool.Exec(context.Background(), `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
				_, _ = st.Pool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1::uuid`, organization.ID)
				_, _ = st.Pool.Exec(context.Background(), `DELETE FROM accounts WHERE id IN ($1::uuid, $2::uuid)`, accountID, ownerID)
			})
			if _, err := st.Pool.Exec(ctx, `
				INSERT INTO organization_memberships (account_id, organization_id, role)
				VALUES ($1::uuid, $2::uuid, 'owner')`, ownerID, organization.ID,
			); err != nil {
				t.Fatal(err)
			}
			var invitationID string
			if err := st.Pool.QueryRow(ctx, `
				INSERT INTO organization_invitations (organization_id, email, expires_at)
				VALUES ($1::uuid, $2, now() + interval '1 day') RETURNING id::text`, organization.ID, email,
			).Scan(&invitationID); err != nil {
				t.Fatal(err)
			}
			accountLock, err := st.Pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = accountLock.Rollback(context.Background()) }()
			if _, err := accountLock.Exec(ctx, `SELECT id FROM accounts WHERE id = $1::uuid FOR UPDATE`, accountID); err != nil {
				t.Fatal(err)
			}

			verifiedAt := time.Now().UTC()
			account := Account{ID: accountID, Email: email, EmailVerifiedAt: &verifiedAt}
			acceptDone := make(chan error, 1)
			deleteDone := make(chan error, 1)
			startAccept := func() {
				go func() {
					_, err := st.RespondToOrganizationInvitation(ctx, invitationID, account, true, AuditEvent{
						ActorType: "account", ActorID: accountID, ResourceType: "invitation",
						RequestID: requestPrefix + "-accept", Metadata: EmptyAuditMetadata{},
					})
					acceptDone <- err
				}()
			}
			startDelete := func() {
				go func() {
					_, err := st.DeleteAccount(ctx, accountID, deletionTestAudit(requestPrefix+"-delete"))
					deleteDone <- err
				}()
			}
			if acceptanceFirst {
				startAccept()
			} else {
				startDelete()
			}
			waitForAdminDeleteRowLock(t, ctx, st, `
				SELECT id::text FROM organization_invitations
				WHERE id = $1::uuid FOR UPDATE NOWAIT`, invitationID)
			if acceptanceFirst {
				startDelete()
			} else {
				startAccept()
			}
			if err := accountLock.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			deleteErr := <-deleteDone
			acceptErr := <-acceptDone
			if deleteErr != nil {
				t.Fatalf("delete result: %v", deleteErr)
			}
			if acceptanceFirst && acceptErr != nil {
				t.Fatalf("acceptance-first result: %v", acceptErr)
			}
			if !acceptanceFirst && !errors.Is(acceptErr, ErrNotFound) {
				t.Fatalf("delete-first acceptance result: %v", acceptErr)
			}
		})
	}
}

func insertAdminDeleteTestAccount(t *testing.T, ctx context.Context, st *Store, email string) string {
	t.Helper()
	var accountID string
	if err := st.Pool.QueryRow(ctx, `
		INSERT INTO accounts (email, email_verified_at) VALUES ($1, now()) RETURNING id::text`, email,
	).Scan(&accountID); err != nil {
		t.Fatal(err)
	}
	return accountID
}

func deletionTestAudit(requestID string) AuditEvent {
	return AuditEvent{ActorType: "account", ActorID: "admin-delete-test-operator", RequestID: requestID}
}

func waitForAdminDeleteRowLock(t *testing.T, ctx context.Context, st *Store, query, id string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var ignored string
		err := st.Pool.QueryRow(ctx, query, id).Scan(&ignored)
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "55P03" {
			return
		}
		if err != nil {
			t.Fatalf("probe row lock: %v", err)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for row lock")
}
