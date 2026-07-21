package api

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/config"
	"github.com/archura/core/internal/store"
)

type fakeBillingProvider struct {
	customerID    string
	checkoutURL   string
	portalURL     string
	webhook       billingWebhook
	subscription  billingSubscription
	customers     int
	checkouts     int
	portals       int
	lastTrialDays int64
}

func (f *fakeBillingProvider) CreateCustomer(_ context.Context, _ billingCustomerInput) (string, error) {
	f.customers++
	return f.customerID, nil
}

func (f *fakeBillingProvider) CreateCheckout(_ context.Context, input billingCheckoutInput) (string, error) {
	f.checkouts++
	f.lastTrialDays = input.TrialPeriodDays
	return f.checkoutURL, nil
}

func (f *fakeBillingProvider) CreatePortal(_ context.Context, _, _ string) (string, error) {
	f.portals++
	return f.portalURL, nil
}

func (f *fakeBillingProvider) ParseWebhook(_ []byte, _, _ string) (billingWebhook, error) {
	return f.webhook, nil
}

func (f *fakeBillingProvider) RetrieveSubscription(_ context.Context, _ string) (billingSubscription, error) {
	return f.subscription, nil
}

func TestOrganizationEntitlementLifecycle(t *testing.T) {
	now := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	unstarted := store.OrganizationEntitlementFor(store.OrganizationBilling{}, "owner", now)
	if unstarted.Status != "unstarted" || !unstarted.CanEdit || unstarted.CanServe || !unstarted.CanManageBilling {
		t.Fatalf("unstarted entitlement = %+v", unstarted)
	}
	trialEnd := now.Add(store.TrialDuration)
	graceEnd := trialEnd.Add(store.ServingGracePeriod)
	billing := store.OrganizationBilling{TrialEndsAt: &trialEnd, ServeGraceEndsAt: &graceEnd}
	trial := store.OrganizationEntitlementFor(billing, "member", trialEnd.Add(-time.Second))
	if trial.Status != "trialing" || !trial.CanEdit || !trial.CanServe || trial.CanManageBilling {
		t.Fatalf("trial entitlement = %+v", trial)
	}
	grace := store.OrganizationEntitlementFor(billing, "owner", trialEnd)
	if grace.Status != "grace" || grace.CanEdit || !grace.CanServe {
		t.Fatalf("grace entitlement = %+v", grace)
	}
	expired := store.OrganizationEntitlementFor(billing, "owner", graceEnd)
	if expired.Status != "expired" || expired.CanEdit || expired.CanServe {
		t.Fatalf("expired entitlement = %+v", expired)
	}
	billing.StripeSubscriptionStatus = "active"
	active := store.OrganizationEntitlementFor(billing, "owner", graceEnd.Add(time.Hour))
	if active.Status != "active" || !active.CanEdit || !active.CanServe {
		t.Fatalf("active entitlement = %+v", active)
	}
	paymentFailedAt := now
	billing.StripeSubscriptionStatus = "past_due"
	billing.LastStripeEventAt = &paymentFailedAt
	pastDue := store.OrganizationEntitlementFor(billing, "owner", now.Add(time.Hour))
	if pastDue.Status != "grace" || pastDue.CanEdit || !pastDue.CanServe {
		t.Fatalf("past-due entitlement = %+v", pastDue)
	}
	periodEnd := now.Add(time.Hour)
	billing.StripeSubscriptionStatus = "canceled"
	billing.CurrentPeriodEnd = &periodEnd
	canceledPaidThrough := store.OrganizationEntitlementFor(billing, "owner", now)
	if canceledPaidThrough.Status != "active" || !canceledPaidThrough.CanEdit || !canceledPaidThrough.CanServe {
		t.Fatalf("canceled paid-through entitlement = %+v", canceledPaidThrough)
	}
	canceledGrace := store.OrganizationEntitlementFor(billing, "owner", periodEnd.Add(time.Hour))
	if canceledGrace.Status != "grace" || canceledGrace.CanEdit || !canceledGrace.CanServe {
		t.Fatalf("canceled grace entitlement = %+v", canceledGrace)
	}
	billing.FreeNoExpiry = true
	canceledToFree := store.OrganizationEntitlementFor(billing, "owner", periodEnd.Add(2*store.ServingGracePeriod))
	if canceledToFree.Status != "active" || !canceledToFree.CanEdit || !canceledToFree.CanServe {
		t.Fatalf("canceled-to-free entitlement = %+v", canceledToFree)
	}
}

func TestFreeNoExpiryKeepsOrganizationEditableAndServing(t *testing.T) {
	now := time.Now().UTC()
	past := now.Add(-time.Hour)
	entitlement := store.OrganizationEntitlementFor(store.OrganizationBilling{
		TrialEndsAt: &past, ServeGraceEndsAt: &past, FreeNoExpiry: true,
	}, "owner", now)
	if entitlement.Status != "active" || !entitlement.CanEdit || !entitlement.CanServe {
		t.Fatalf("free-no-expiry entitlement = %+v", entitlement)
	}
}

func TestTrialStartsAfterCustomerWasCreated(t *testing.T) {
	repo, server, token, organizationID := billingTestServer(t, "owner")
	repo.billing = make(map[string]store.OrganizationBilling)
	repo.billing[organizationID] = store.OrganizationBilling{
		OrganizationID: organizationID, StripeCustomerID: "cus_checkout_abandoned",
	}
	now := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	response := performRequest(server.Router(), http.MethodPost,
		"/v1/organizations/"+organizationID+"/billing/start-trial", "", token)
	if response.Code != http.StatusOK || repo.billing[organizationID].TrialStartedAt == nil {
		t.Fatalf("trial after customer status=%d billing=%+v", response.Code, repo.billing[organizationID])
	}
}

func TestTrialCheckoutAndWebhookFlow(t *testing.T) {
	repo, server, token, organizationID := billingTestServer(t, "owner")
	provider := &fakeBillingProvider{
		customerID: "cus_test_customer", checkoutURL: "https://checkout.stripe.test/session",
		portalURL: "https://billing.stripe.test/portal",
	}
	server.billing = provider
	now := time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC)
	server.now = func() time.Time { return now }
	router := server.Router()

	trialResponse := performRequest(router, http.MethodPost,
		"/v1/organizations/"+organizationID+"/billing/start-trial", "", token)
	if trialResponse.Code != http.StatusOK || !containsJSON(trialResponse.Body.String(), `"status":"trialing"`, `"can_edit":true`) {
		t.Fatalf("start trial status=%d body=%s", trialResponse.Code, trialResponse.Body.String())
	}
	firstEnd := repo.billing[organizationID].TrialEndsAt
	secondResponse := performRequest(router, http.MethodPost,
		"/v1/organizations/"+organizationID+"/billing/start-trial", "", token)
	if secondResponse.Code != http.StatusOK || repo.billing[organizationID].TrialEndsAt != firstEnd {
		t.Fatalf("repeated trial changed deadline: status=%d billing=%+v", secondResponse.Code, repo.billing[organizationID])
	}

	checkoutResponse := performRequest(router, http.MethodPost,
		"/v1/organizations/"+organizationID+"/billing/checkout", "", token)
	if checkoutResponse.Code != http.StatusCreated || provider.customers != 1 || provider.checkouts != 1 {
		t.Fatalf("checkout status=%d provider=%+v body=%s", checkoutResponse.Code, provider, checkoutResponse.Body.String())
	}
	// Checkout must defer the first charge with a 14-day Stripe trial, not
	// charge immediately.
	if provider.lastTrialDays != basicTrialDays {
		t.Fatalf("checkout trial days = %d, want %d", provider.lastTrialDays, basicTrialDays)
	}

	periodEnd := now.Add(31 * 24 * time.Hour)
	provider.webhook = billingWebhook{
		ID: "evt_subscription", Type: "customer.subscription.updated", CreatedAt: now.Add(time.Minute),
		SubscriptionID: "sub_test_subscription",
	}
	provider.subscription = billingSubscription{
		ID: "sub_test_subscription", CustomerID: provider.customerID, OrganizationID: organizationID,
		Status: "active", CurrentPeriodEnd: &periodEnd,
	}
	webhookResponse := performRequest(router, http.MethodPost, "/stripe/webhooks", `{}`, "")
	if webhookResponse.Code != http.StatusNoContent {
		t.Fatalf("webhook status=%d body=%s", webhookResponse.Code, webhookResponse.Body.String())
	}
	if repo.billing[organizationID].StripeSubscriptionStatus != "active" {
		t.Fatalf("billing after webhook = %+v", repo.billing[organizationID])
	}
	duplicate := performRequest(router, http.MethodPost, "/stripe/webhooks", `{}`, "")
	if duplicate.Code != http.StatusNoContent {
		t.Fatalf("duplicate webhook status=%d body=%s", duplicate.Code, duplicate.Body.String())
	}

	portalResponse := performRequest(router, http.MethodPost,
		"/v1/organizations/"+organizationID+"/billing/portal", "", token)
	if portalResponse.Code != http.StatusCreated || provider.portals != 1 {
		t.Fatalf("portal status=%d body=%s", portalResponse.Code, portalResponse.Body.String())
	}
}

func TestMemberCannotManageBilling(t *testing.T) {
	_, server, token, organizationID := billingTestServer(t, "member")
	server.billing = &fakeBillingProvider{}
	response := performRequest(server.Router(), http.MethodPost,
		"/v1/organizations/"+organizationID+"/billing/checkout", "", token)
	if response.Code != http.StatusForbidden {
		t.Fatalf("member checkout status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestCheckoutDoesNotCreateASecondSubscription(t *testing.T) {
	repo, server, token, organizationID := billingTestServer(t, "owner")
	repo.billing = map[string]store.OrganizationBilling{organizationID: {
		OrganizationID: organizationID, StripeCustomerID: "cus_existing",
		StripeSubscriptionID: "sub_existing", StripeSubscriptionStatus: "past_due",
	}}
	provider := &fakeBillingProvider{}
	server.billing = provider
	response := performRequest(server.Router(), http.MethodPost,
		"/v1/organizations/"+organizationID+"/billing/checkout", "", token)
	if response.Code != http.StatusConflict || provider.checkouts != 0 {
		t.Fatalf("duplicate checkout status=%d checkouts=%d body=%s", response.Code, provider.checkouts, response.Body.String())
	}
}

func TestBillingRecoveryReleasesSiteBinding(t *testing.T) {
	repo, server, _, organizationID := billingTestServer(t, "owner")
	repo.sites = map[string]string{"expired-site": organizationID}
	response := performRequest(server.Router(), http.MethodDelete,
		"/v1/organizations/"+organizationID+"/sites/expired-site", "", server.cfg.CoreInternalKey)
	if response.Code != http.StatusNoContent || repo.sites["expired-site"] != "" {
		t.Fatalf("release status=%d sites=%+v body=%s", response.Code, repo.sites, response.Body.String())
	}
}

// Doctrine: reachability is never authorization. These endpoints must
// self-defend even with edge auth off (as it is throughout this test server).
func TestMachineEndpointsRejectCallersWithoutInternalKey(t *testing.T) {
	repo, server, sessionToken, organizationID := billingTestServer(t, "owner")
	repo.sites = map[string]string{"expired-site": organizationID}

	for name, bearer := range map[string]string{"no credential": "", "session is not the internal key": sessionToken} {
		release := performRequest(server.Router(), http.MethodDelete,
			"/v1/organizations/"+organizationID+"/sites/expired-site", "", bearer)
		if release.Code != http.StatusUnauthorized || repo.sites["expired-site"] != organizationID {
			t.Fatalf("release with %s: status=%d sites=%+v", name, release.Code, repo.sites)
		}
	}

	entitlement := performRequest(server.Router(), http.MethodGet,
		"/v1/organizations/"+organizationID+"/entitlement", "", "")
	if entitlement.Code != http.StatusUnauthorized {
		t.Fatalf("entitlement without credential: status=%d body=%s", entitlement.Code, entitlement.Body.String())
	}
}

func TestEntitlementAllowsInternalKeyAndMemberSession(t *testing.T) {
	_, server, sessionToken, organizationID := billingTestServer(t, "member")

	viaInternal := performRequest(server.Router(), http.MethodGet,
		"/v1/organizations/"+organizationID+"/entitlement", "", server.cfg.CoreInternalKey)
	if viaInternal.Code != http.StatusOK {
		t.Fatalf("entitlement via internal key: status=%d body=%s", viaInternal.Code, viaInternal.Body.String())
	}

	viaSession := performRequest(server.Router(), http.MethodGet,
		"/v1/organizations/"+organizationID+"/entitlement", "", sessionToken)
	if viaSession.Code != http.StatusOK {
		t.Fatalf("entitlement via member session: status=%d body=%s", viaSession.Code, viaSession.Body.String())
	}

	otherOrg := performRequest(server.Router(), http.MethodGet,
		"/v1/organizations/some-other-organization/entitlement", "", sessionToken)
	if otherOrg.Code != http.StatusNotFound {
		t.Fatalf("entitlement for non-membership org: status=%d body=%s", otherOrg.Code, otherOrg.Body.String())
	}
}

func billingTestServer(t *testing.T, role string) (*fakeRepository, *Server, string, string) {
	t.Helper()
	token, err := archauth.Generate("sess", "dev")
	if err != nil {
		t.Fatal(err)
	}
	accountID := "account-billing"
	organizationID := "organization-billing"
	now := time.Now().UTC()
	repo := &fakeRepository{
		accounts: map[string]store.Account{accountID: {ID: accountID, Email: "payer@example.com", CreatedAt: now}},
		accountSessions: map[string]store.AccountSession{archauth.Hash(token): {
			ID: "session-billing", AccountID: accountID, TokenHash: archauth.Hash(token),
			ExpiresAt: now.Add(time.Hour), CreatedAt: now,
		}},
		organizations: map[string][]store.AccountOrganization{accountID: {{
			Organization: store.Organization{ID: organizationID, Name: "Billing Business", Status: "active"},
			Role:         role, Sites: []string{},
		}},
		},
	}
	internalKey, err := archauth.Generate("int", "dev")
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(config.Config{
		Env: "dev", StripeBasicPriceID: "price_basic", StripeWebhookSecret: "test-webhook-signature",
		BillingPublicOrigin: "http://localhost:8787", CoreInternalKey: internalKey,
	}, repo, slog.Default())
	return repo, server, token, organizationID
}

func containsJSON(value string, fragments ...string) bool {
	for _, fragment := range fragments {
		if !strings.Contains(value, fragment) {
			return false
		}
	}
	return true
}
