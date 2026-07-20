package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/config"
	"github.com/archura/core/internal/store"
	"github.com/archura/core/internal/telemetry"
)

const (
	testAdminKey    = "adm_test_local_admin"
	testComponentID = "cmp_test_01234567890123456789"
)

type fakeRepository struct {
	organization        store.Organization
	secretHash          string
	publishableKey      string
	edgeClaimToken      string
	component           store.PaymentComponent
	session             store.ComponentSession
	componentSession    map[string]store.ComponentSession
	audits              []store.AuditEvent
	rateLimitDenied     bool
	confirmations       map[string]store.EmailConfirmation
	accounts            map[string]store.Account
	accountByEmail      map[string]string
	accountSessions     map[string]store.AccountSession
	organizations       map[string][]store.AccountOrganization
	invitations         map[string]store.OrganizationInvitation
	invitationCreateErr error
	sites               map[string]string
	nextID              int
	rateLimitCalls      []fakeRateLimitCall
	revokeSessionErr    error
	billing             map[string]store.OrganizationBilling
	webhookEvents       map[string]string
}

type fakeRateLimitCall struct {
	Subject   string
	Operation string
	Limit     int
	Window    time.Duration
}

func (f *fakeRepository) Ping(context.Context) error { return nil }

func (f *fakeRepository) DBStats() telemetry.DBStats { return telemetry.DBStats{} }

func (f *fakeRepository) CreateOrganization(_ context.Context, p store.CreateOrganizationParams, audit store.AuditEvent) (store.Organization, error) {
	if f.organization.ID != "" {
		return store.Organization{}, store.ErrConflict
	}
	f.organization = store.Organization{
		ID: "00000000-0000-0000-0000-000000000001", Name: p.Name, Slug: p.Slug,
		AllowedOrigins: p.AllowedOrigins, Status: "active", CreatedAt: time.Now().UTC(),
	}
	f.secretHash = p.SecretKeyHash
	f.publishableKey = p.PublishableKey
	f.edgeClaimToken = p.EdgeClaimToken
	audit.OrganizationID = f.organization.ID
	audit.ResourceID = f.organization.ID
	f.audits = append(f.audits, audit)
	return f.organization, nil
}

func (f *fakeRepository) OrganizationBySecretHash(_ context.Context, hash string) (store.Organization, error) {
	if hash != f.secretHash {
		return store.Organization{}, store.ErrNotFound
	}
	return f.organization, nil
}

func (f *fakeRepository) UpsertPaymentComponent(_ context.Context, component store.PaymentComponent, audit store.AuditEvent) (store.PaymentComponent, error) {
	if f.component.ID != "" && f.component.OrganizationID != component.OrganizationID {
		return store.PaymentComponent{}, store.ErrNotFound
	}
	component.CreatedAt = time.Now().UTC()
	component.UpdatedAt = component.CreatedAt
	f.component = component
	f.audits = append(f.audits, audit)
	return component, nil
}

func (f *fakeRepository) PaymentComponentForOrganization(_ context.Context, organizationID, componentID string) (store.PaymentComponent, error) {
	if f.component.ID != componentID || f.component.OrganizationID != organizationID || f.component.Status != "active" {
		return store.PaymentComponent{}, store.ErrNotFound
	}
	return f.component, nil
}

func (f *fakeRepository) CreateComponentSession(_ context.Context, session store.ComponentSession, audit store.AuditEvent) (store.ComponentSession, error) {
	f.session = session
	if f.componentSession == nil {
		f.componentSession = make(map[string]store.ComponentSession)
	}
	f.componentSession[session.TokenHash] = session
	f.audits = append(f.audits, audit)
	return session, nil
}

func (f *fakeRepository) ComponentSessionByTokenHash(_ context.Context, hash string) (store.ComponentSession, error) {
	session, ok := f.componentSession[hash]
	if !ok {
		return store.ComponentSession{}, store.ErrNotFound
	}
	return session, nil
}

func (f *fakeRepository) CreateConfirmation(_ context.Context, confirmation store.EmailConfirmation, audit store.AuditEvent) (store.EmailConfirmation, error) {
	if f.confirmations == nil {
		f.confirmations = make(map[string]store.EmailConfirmation)
	}
	f.nextID++
	confirmation.ID = "confirmation-" + strconv.Itoa(f.nextID)
	confirmation.CreatedAt = time.Now().UTC()
	f.confirmations[confirmation.TokenHash] = confirmation
	audit.ResourceID = confirmation.ID
	f.audits = append(f.audits, audit)
	return confirmation, nil
}

func (f *fakeRepository) ConfirmationByTokenHash(_ context.Context, hash string) (store.EmailConfirmation, error) {
	confirmation, ok := f.confirmations[hash]
	if !ok {
		return store.EmailConfirmation{}, store.ErrNotFound
	}
	return confirmation, nil
}

func (f *fakeRepository) VerifyConfirmation(_ context.Context, p store.VerifyConfirmationParams) (store.VerifyConfirmationResult, error) {
	confirmation, ok := f.confirmations[p.TokenHash]
	if !ok || confirmation.UsedAt != nil || !confirmation.ExpiresAt.After(time.Now()) {
		return store.VerifyConfirmationResult{}, store.ErrNotFound
	}
	accountID := f.accountByEmail[confirmation.Email]
	if confirmation.Subdomain != nil {
		if ownerID := f.sites[*confirmation.Subdomain]; ownerID != "" && ownerID != accountID && !f.accountOwnsOrganization(accountID, ownerID) {
			return store.VerifyConfirmationResult{}, store.ErrConflict
		}
	}
	if f.accounts == nil {
		f.accounts = make(map[string]store.Account)
		f.accountByEmail = make(map[string]string)
	}
	created := accountID == ""
	if created {
		f.nextID++
		accountID = "account-" + strconv.Itoa(f.nextID)
		now := time.Now().UTC()
		f.accounts[accountID] = store.Account{ID: accountID, Email: confirmation.Email, EmailVerifiedAt: &now, CreatedAt: now}
		f.accountByEmail[confirmation.Email] = accountID
	} else if f.accounts[accountID].EmailVerifiedAt == nil {
		account := f.accounts[accountID]
		now := time.Now().UTC()
		account.EmailVerifiedAt = &now
		f.accounts[accountID] = account
	}
	organization := f.ensureFakeDefaultOrganization(f.accounts[accountID], p.PublishableKey)
	if f.sites == nil {
		f.sites = make(map[string]string)
	}
	if confirmation.Subdomain != nil {
		if ownerID := f.sites[*confirmation.Subdomain]; ownerID != "" && ownerID != organization.ID && ownerID != accountID {
			return store.VerifyConfirmationResult{}, store.ErrConflict
		}
		f.sites[*confirmation.Subdomain] = organization.ID
	}
	now := time.Now().UTC()
	confirmation.UsedAt = &now
	f.confirmations[p.TokenHash] = confirmation
	if f.accountSessions == nil {
		f.accountSessions = make(map[string]store.AccountSession)
	}
	f.nextID++
	session := store.AccountSession{
		ID: "session-" + strconv.Itoa(f.nextID), TokenHash: p.SessionTokenHash,
		AccountID: accountID, ExpiresAt: p.SessionExpiresAt, CreatedAt: now,
	}
	f.accountSessions[p.SessionTokenHash] = session
	f.audits = append(f.audits, store.AuditEvent{Action: "confirmation.verified"})
	if created {
		f.audits = append(f.audits, store.AuditEvent{Action: "account.created"})
	}
	if confirmation.Subdomain != nil {
		f.audits = append(f.audits, store.AuditEvent{Action: "site_ownership.bound"})
	}
	f.audits = append(f.audits, store.AuditEvent{Action: "session.created"})
	return store.VerifyConfirmationResult{
		Account: f.accounts[accountID], Organization: organization.Organization,
		PublishableKey: organization.PublishableKey, Subdomain: confirmation.Subdomain, Session: session,
	}, nil
}

func (f *fakeRepository) AccountByEmail(_ context.Context, email string) (store.Account, error) {
	accountID := f.accountByEmail[email]
	if accountID == "" {
		return store.Account{}, store.ErrNotFound
	}
	return f.accounts[accountID], nil
}

func (f *fakeRepository) SessionByTokenHash(_ context.Context, hash string) (store.AccountSession, error) {
	session, ok := f.accountSessions[hash]
	if !ok || session.RevokedAt != nil || !session.ExpiresAt.After(time.Now()) {
		return store.AccountSession{}, store.ErrNotFound
	}
	return session, nil
}

func (f *fakeRepository) RevokeSessionByTokenHash(_ context.Context, hash string) error {
	if f.revokeSessionErr != nil {
		return f.revokeSessionErr
	}
	session, ok := f.accountSessions[hash]
	if !ok {
		return nil
	}
	if session.RevokedAt == nil {
		now := time.Now().UTC()
		session.RevokedAt = &now
		f.accountSessions[hash] = session
	}
	return nil
}

func (f *fakeRepository) AccountByID(_ context.Context, id string) (store.Account, error) {
	account, ok := f.accounts[id]
	if !ok {
		return store.Account{}, store.ErrNotFound
	}
	return account, nil
}

func (f *fakeRepository) SitesForAccount(_ context.Context, accountID string) ([]string, error) {
	sites := make([]string, 0)
	for subdomain, ownerID := range f.sites {
		if ownerID == accountID || f.accountOwnsOrganization(accountID, ownerID) {
			sites = append(sites, subdomain)
		}
	}
	sort.Strings(sites)
	return sites, nil
}

func (f *fakeRepository) BindSiteOwnership(_ context.Context, subdomain, accountID string, audit store.AuditEvent) error {
	organizations := f.organizations[accountID]
	for _, organization := range organizations {
		if organization.IsDefault {
			return f.BindOrganizationSite(context.Background(), subdomain, organization.ID, accountID, audit)
		}
	}
	return store.ErrNotFound
}

func (f *fakeRepository) EnsureDefaultOrganization(_ context.Context, account store.Account, p store.CreateOrganizationParams, _ string) (store.AccountOrganization, error) {
	return f.ensureFakeDefaultOrganization(account, p.PublishableKey), nil
}

func (f *fakeRepository) OrganizationsForAccount(_ context.Context, accountID string) ([]store.AccountOrganization, error) {
	organizations := append([]store.AccountOrganization(nil), f.organizations[accountID]...)
	for i := range organizations {
		organizations[i].Sites = make([]string, 0)
		for site, ownerID := range f.sites {
			if ownerID == organizations[i].ID || (organizations[i].IsDefault && ownerID == accountID) {
				organizations[i].Sites = append(organizations[i].Sites, site)
			}
		}
		sort.Strings(organizations[i].Sites)
	}
	return organizations, nil
}

func (f *fakeRepository) CreateOrganizationForAccount(_ context.Context, accountID string, p store.CreateOrganizationParams, audit store.AuditEvent) (store.AccountOrganization, error) {
	for _, organizations := range f.organizations {
		for _, organization := range organizations {
			if organization.Slug == p.Slug {
				return store.AccountOrganization{}, store.ErrConflict
			}
		}
	}
	f.nextID++
	organization := store.AccountOrganization{
		Organization: store.Organization{
			ID: "organization-" + strconv.Itoa(f.nextID), Name: p.Name, Slug: p.Slug,
			AllowedOrigins: p.AllowedOrigins, Status: "active", CreatedAt: time.Now().UTC(),
		},
		Role: "owner", PublishableKey: p.PublishableKey, Sites: []string{},
	}
	if f.organizations == nil {
		f.organizations = make(map[string][]store.AccountOrganization)
	}
	f.organizations[accountID] = append(f.organizations[accountID], organization)
	f.audits = append(f.audits, audit)
	return organization, nil
}

func (f *fakeRepository) CreateOrganizationInvitation(
	_ context.Context,
	organizationID, invitedByAccountID, email string,
	expiresAt time.Time,
	audit store.AuditEvent,
) (store.OrganizationInvitation, error) {
	owner := false
	for _, organization := range f.organizations[invitedByAccountID] {
		if organization.ID == organizationID && organization.Role == "owner" {
			owner = true
			break
		}
	}
	if !owner {
		return store.OrganizationInvitation{}, store.ErrNotFound
	}
	if f.invitationCreateErr != nil {
		return store.OrganizationInvitation{}, f.invitationCreateErr
	}
	for accountID, account := range f.accounts {
		if account.Email == email && f.accountOwnsOrganization(accountID, organizationID) {
			return store.OrganizationInvitation{}, store.ErrAlreadyMember
		}
	}
	if f.invitations == nil {
		f.invitations = make(map[string]store.OrganizationInvitation)
	}
	for id, invitation := range f.invitations {
		if invitation.OrganizationID == organizationID && invitation.Email == email && invitation.Status == "pending" {
			invitation.InvitedByAccountID = invitedByAccountID
			invitation.InvitedByEmail = f.accounts[invitedByAccountID].Email
			invitation.ExpiresAt = expiresAt
			invitation.RespondedAt = nil
			f.invitations[id] = invitation
			f.audits = append(f.audits, audit)
			return invitation, nil
		}
	}
	f.nextID++
	invitation := store.OrganizationInvitation{
		ID: "invitation-" + strconv.Itoa(f.nextID), OrganizationID: organizationID,
		Email: email, Role: "member", InvitedByAccountID: invitedByAccountID,
		InvitedByEmail: f.accounts[invitedByAccountID].Email, Status: "pending",
		ExpiresAt: expiresAt, CreatedAt: time.Now().UTC(),
	}
	for _, organizations := range f.organizations {
		for _, organization := range organizations {
			if organization.ID == organizationID {
				invitation.OrganizationName = organization.Name
			}
		}
	}
	f.invitations[invitation.ID] = invitation
	f.audits = append(f.audits, audit)
	return invitation, nil
}

func (f *fakeRepository) PendingInvitationsForEmail(_ context.Context, email string) ([]store.OrganizationInvitation, error) {
	result := make([]store.OrganizationInvitation, 0)
	for _, invitation := range f.invitations {
		if invitation.Email == email && invitation.Status == "pending" && invitation.ExpiresAt.After(time.Now()) {
			result = append(result, invitation)
		}
	}
	return result, nil
}

func (f *fakeRepository) RespondToOrganizationInvitation(
	_ context.Context,
	invitationID string,
	account store.Account,
	accept bool,
	audit store.AuditEvent,
) (store.OrganizationInvitation, error) {
	invitation, ok := f.invitations[invitationID]
	if !ok || account.EmailVerifiedAt == nil || invitation.Email != account.Email ||
		invitation.Status != "pending" || !invitation.ExpiresAt.After(time.Now()) {
		return store.OrganizationInvitation{}, store.ErrNotFound
	}
	now := time.Now().UTC()
	invitation.RespondedAt = &now
	invitation.Status = "declined"
	if accept {
		invitation.Status = "accepted"
		if !f.accountOwnsOrganization(account.ID, invitation.OrganizationID) {
			f.organizations[account.ID] = append(f.organizations[account.ID], store.AccountOrganization{
				Organization: store.Organization{ID: invitation.OrganizationID, Name: invitation.OrganizationName, Status: "active"},
				Role:         "member", Sites: []string{},
			})
		}
	}
	f.invitations[invitationID] = invitation
	f.audits = append(f.audits, audit)
	return invitation, nil
}

func (f *fakeRepository) BindOrganizationSite(_ context.Context, subdomain, organizationID, accountID string, audit store.AuditEvent) error {
	if !f.accountOwnsOrganization(accountID, organizationID) {
		return store.ErrNotFound
	}
	if f.sites == nil {
		f.sites = make(map[string]string)
	}
	if ownerID := f.sites[subdomain]; ownerID != "" && ownerID != organizationID && ownerID != accountID {
		return store.ErrConflict
	}
	f.sites[subdomain] = organizationID
	f.audits = append(f.audits, audit)
	return nil
}

func (f *fakeRepository) ReleaseOrganizationSite(_ context.Context, subdomain, organizationID string, audit store.AuditEvent) error {
	if f.sites != nil && f.sites[subdomain] == organizationID {
		delete(f.sites, subdomain)
		f.audits = append(f.audits, audit)
	}
	return nil
}

func (f *fakeRepository) ensureFakeDefaultOrganization(account store.Account, publishableKey string) store.AccountOrganization {
	if f.organizations == nil {
		f.organizations = make(map[string][]store.AccountOrganization)
	}
	for _, organization := range f.organizations[account.ID] {
		if organization.IsDefault {
			return organization
		}
	}
	organization := store.AccountOrganization{
		Organization: store.Organization{
			ID: "organization-" + account.ID, Name: "Default organization", Slug: "org-" + account.ID,
			Status: "active", CreatedAt: time.Now().UTC(),
		},
		Role: "owner", IsDefault: true, PublishableKey: publishableKey, Sites: []string{},
	}
	f.organizations[account.ID] = append(f.organizations[account.ID], organization)
	return organization
}

func (f *fakeRepository) accountOwnsOrganization(accountID, organizationID string) bool {
	for _, organization := range f.organizations[accountID] {
		if organization.ID == organizationID {
			return true
		}
	}
	return false
}

func (f *fakeRepository) RecordAudit(_ context.Context, audit store.AuditEvent) error {
	f.audits = append(f.audits, audit)
	return nil
}

func (f *fakeRepository) ConsumeRateLimit(_ context.Context, subject, operation string, limit int, window time.Duration) (store.RateLimitResult, error) {
	f.rateLimitCalls = append(f.rateLimitCalls, fakeRateLimitCall{Subject: subject, Operation: operation, Limit: limit, Window: window})
	return store.RateLimitResult{Allowed: !f.rateLimitDenied, Count: 1, RetryAfterSeconds: 42}, nil
}

func (f *fakeRepository) BillingForOrganization(_ context.Context, organizationID string) (store.OrganizationBilling, error) {
	if f.billing == nil {
		f.billing = make(map[string]store.OrganizationBilling)
	}
	return f.billing[organizationID], nil
}

func (f *fakeRepository) StartOrganizationTrial(_ context.Context, organizationID string, now time.Time, audit store.AuditEvent) (store.OrganizationBilling, error) {
	if f.billing == nil {
		f.billing = make(map[string]store.OrganizationBilling)
	}
	if existing, ok := f.billing[organizationID]; ok && existing.TrialStartedAt != nil {
		return existing, nil
	}
	trialEnd := now.Add(store.TrialDuration)
	graceEnd := trialEnd.Add(store.ServingGracePeriod)
	billing := store.OrganizationBilling{
		OrganizationID: organizationID, TrialStartedAt: &now, TrialEndsAt: &trialEnd,
		ServeGraceEndsAt: &graceEnd, CreatedAt: now, UpdatedAt: now,
	}
	f.billing[organizationID] = billing
	audit.OrganizationID = organizationID
	audit.Action = "billing.trial_started"
	f.audits = append(f.audits, audit)
	return billing, nil
}

func (f *fakeRepository) SetStripeCustomer(_ context.Context, organizationID, customerID string) error {
	billing, _ := f.BillingForOrganization(context.Background(), organizationID)
	billing.OrganizationID = organizationID
	billing.StripeCustomerID = customerID
	f.billing[organizationID] = billing
	return nil
}

func (f *fakeRepository) UpdateStripeSubscription(_ context.Context, update store.StripeSubscriptionUpdate, audit store.AuditEvent) error {
	billing, _ := f.BillingForOrganization(context.Background(), update.OrganizationID)
	if billing.LastStripeEventAt != nil && billing.LastStripeEventAt.After(update.EventCreatedAt) {
		return nil
	}
	billing.OrganizationID = update.OrganizationID
	billing.StripeCustomerID = update.CustomerID
	billing.StripeSubscriptionID = update.SubscriptionID
	billing.StripeSubscriptionStatus = update.Status
	billing.CurrentPeriodEnd = update.CurrentPeriodEnd
	billing.CancelAtPeriodEnd = update.CancelAtPeriodEnd
	billing.LastStripeEventAt = &update.EventCreatedAt
	f.billing[update.OrganizationID] = billing
	f.audits = append(f.audits, audit)
	return nil
}

func (f *fakeRepository) OrganizationIDByStripeCustomer(_ context.Context, customerID string) (string, error) {
	for organizationID, billing := range f.billing {
		if billing.StripeCustomerID == customerID {
			return organizationID, nil
		}
	}
	return "", store.ErrNotFound
}

func (f *fakeRepository) ClaimStripeWebhookEvent(_ context.Context, eventID, _ string, _ time.Time) (bool, error) {
	if f.webhookEvents == nil {
		f.webhookEvents = make(map[string]string)
	}
	if f.webhookEvents[eventID] == "processed" {
		return false, nil
	}
	f.webhookEvents[eventID] = "processing"
	return true, nil
}

func (f *fakeRepository) FinishStripeWebhookEvent(_ context.Context, eventID string, processingErr error) error {
	if processingErr != nil {
		f.webhookEvents[eventID] = "failed"
	} else {
		f.webhookEvents[eventID] = "processed"
	}
	return nil
}

func TestClientComponentAndSessionContract(t *testing.T) {
	repo := &fakeRepository{}
	server := NewServer(config.Config{Env: "dev", PlatformAdminKey: testAdminKey}, repo, slog.Default())
	router := server.Router()

	clientBody := `{
		"name":"Mike's Bakery",
		"slug":"mikes-bakery",
		"allowed_origins":["http://localhost:5173"],
		"edge_claim_token":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	}`
	clientResponse := performRequest(router, http.MethodPost, "/v1/clients", clientBody, testAdminKey)
	if clientResponse.Code != http.StatusCreated {
		t.Fatalf("create client status = %d, body = %s", clientResponse.Code, clientResponse.Body.String())
	}
	if strings.Contains(clientResponse.Body.String(), "edge_claim_token") ||
		strings.Contains(clientResponse.Body.String(), repo.edgeClaimToken) {
		t.Fatalf("create client response exposed edge credential: %s", clientResponse.Body.String())
	}
	var createdClient struct {
		PublishableKey string `json:"publishable_key"`
		SecretKey      string `json:"secret_key"`
	}
	if err := json.NewDecoder(clientResponse.Body).Decode(&createdClient); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(createdClient.PublishableKey, "pk_test_") || !strings.HasPrefix(createdClient.SecretKey, "sk_test_") {
		t.Fatalf("development keys have wrong prefixes: pk=%q sk=%q", createdClient.PublishableKey, createdClient.SecretKey)
	}
	if repo.secretHash == createdClient.SecretKey || repo.secretHash != archauth.Hash(createdClient.SecretKey) {
		t.Fatal("organization secret must be stored only as its hash")
	}
	if repo.edgeClaimToken != "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" {
		t.Fatalf("edge claim token was not passed to storage: %q", repo.edgeClaimToken)
	}

	componentBody := `{
		"mode":"payment",
		"stripe_price_id":"price_test_bread",
		"success_url":"http://localhost:5173/order/success",
		"cancel_url":"http://localhost:5173/order/cancel",
		"allowed_origins":["http://localhost:5173"],
		"status":"active"
	}`
	componentResponse := performRequest(router, http.MethodPost, "/v1/components", componentBody, createdClient.SecretKey)
	if componentResponse.Code != http.StatusCreated {
		t.Fatalf("create component status = %d, body = %s", componentResponse.Code, componentResponse.Body.String())
	}
	var createdComponent struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(componentResponse.Body).Decode(&createdComponent); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(createdComponent.ID, "cmp_test_") {
		t.Fatalf("development component ID = %q, want cmp_test_ prefix", createdComponent.ID)
	}
	if repo.component.OrganizationID != repo.organization.ID || repo.component.StripePriceID != "price_test_bread" {
		t.Fatal("component configuration was not bound to the authenticated organization")
	}

	sessionBody := `{
		"component_id":"` + createdComponent.ID + `",
		"external_user_id":"customer_8472",
		"origin":"http://localhost:5173"
	}`
	sessionResponse := performRequest(router, http.MethodPost, "/v1/component-sessions", sessionBody, createdClient.SecretKey)
	if sessionResponse.Code != http.StatusCreated {
		t.Fatalf("create session status = %d, body = %s", sessionResponse.Code, sessionResponse.Body.String())
	}
	var createdSession struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(sessionResponse.Body).Decode(&createdSession); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(createdSession.AccessToken, "ct_test_") || createdSession.ExpiresIn != 600 {
		t.Fatalf("unexpected component session response: %+v", createdSession)
	}
	if repo.session.TokenHash == createdSession.AccessToken || repo.session.TokenHash != archauth.Hash(createdSession.AccessToken) {
		t.Fatal("component token must be stored only as its hash")
	}
	if repo.session.OrganizationID != repo.organization.ID || repo.session.ComponentID != createdComponent.ID ||
		len(repo.session.Scopes) != 1 || repo.session.Scopes[0] != "checkout:create" {
		t.Fatalf("component token has incorrect binding: %+v", repo.session)
	}
	if len(repo.audits) != 3 || repo.audits[0].Action != "organization.created" ||
		repo.audits[1].Action != "component.created" || repo.audits[2].Action != "component_session.created" {
		t.Fatalf("unexpected audit sequence: %+v", repo.audits)
	}
	if metadata, ok := repo.audits[0].Metadata.(store.ClientAuditMetadata); !ok || !metadata.NamespaceBound {
		t.Fatalf("unexpected client audit metadata: %#v", repo.audits[0].Metadata)
	}
	if metadata, ok := repo.audits[2].Metadata.(store.ComponentSessionAuditMetadata); !ok ||
		len(metadata.Scopes) != 1 || metadata.ExpiresInSeconds != 600 {
		t.Fatalf("unexpected session audit metadata: %#v", repo.audits[2].Metadata)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/checkout-sessions", nil)
	request.Header.Set("Authorization", "Bearer "+createdSession.AccessToken)
	request.Header.Set("Origin", "http://localhost:5173")
	if _, ok := server.authenticateComponentSession(httptest.NewRecorder(), request, "checkout:create"); !ok {
		t.Fatal("fresh component token should authorize its bound action")
	}
}

func TestCreateClientWithoutNamespaceBinding(t *testing.T) {
	repo := &fakeRepository{}
	server := NewServer(config.Config{Env: "dev", PlatformAdminKey: testAdminKey}, repo, slog.Default())
	response := performRequest(server.Router(), http.MethodPost, "/v1/clients", `{
		"name":"Unbound Client",
		"slug":"unbound-client",
		"allowed_origins":["http://localhost:5173"]
	}`, testAdminKey)
	if response.Code != http.StatusCreated {
		t.Fatalf("create unbound client status = %d, body = %s", response.Code, response.Body.String())
	}
	if repo.edgeClaimToken != "" {
		t.Fatalf("unbound client edge token = %q, want empty", repo.edgeClaimToken)
	}
	if len(repo.audits) != 1 {
		t.Fatalf("audit count = %d, want 1", len(repo.audits))
	}
	if metadata, ok := repo.audits[0].Metadata.(store.ClientAuditMetadata); !ok || metadata.NamespaceBound {
		t.Fatalf("unexpected unbound client audit metadata: %#v", repo.audits[0].Metadata)
	}
}

func TestCreateClientRejectsOversizedEdgeClaimToken(t *testing.T) {
	repo := &fakeRepository{}
	server := NewServer(config.Config{Env: "dev", PlatformAdminKey: testAdminKey}, repo, slog.Default())
	body, err := json.Marshal(map[string]any{
		"name": "Oversized Token", "slug": "oversized-token",
		"allowed_origins":  []string{"http://localhost:5173"},
		"edge_claim_token": strings.Repeat("x", 129),
	})
	if err != nil {
		t.Fatal(err)
	}
	response := performRequest(server.Router(), http.MethodPost, "/v1/clients", string(body), testAdminKey)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("oversized edge token status = %d, want 400; body = %s", response.Code, response.Body.String())
	}
	if repo.organization.ID != "" {
		t.Fatal("oversized edge token must not create an organization")
	}
}

func TestComponentSessionRejectsCrossOrganizationComponent(t *testing.T) {
	secret := "sk_test_0123456789012345678901234567890123456789012"
	repo := &fakeRepository{
		organization: store.Organization{ID: "organization-a", Status: "active", AllowedOrigins: []string{"http://localhost:5173"}},
		secretHash:   archauth.Hash(secret),
		component:    store.PaymentComponent{ID: testComponentID, OrganizationID: "organization-b", Status: "active", AllowedOrigins: []string{"http://localhost:5173"}},
	}
	server := NewServer(config.Config{Env: "dev"}, repo, slog.Default())
	body := `{"component_id":"` + testComponentID + `","origin":"http://localhost:5173"}`
	response := performRequest(server.Router(), http.MethodPost, "/v1/component-sessions", body, secret)
	if response.Code != http.StatusNotFound {
		t.Fatalf("cross-organization mint status = %d, want 404; body = %s", response.Code, response.Body.String())
	}
}

func TestComponentSessionEnforcesOriginExpiryAndScope(t *testing.T) {
	token := "ct_test_0123456789012345678901234567890123456789012"
	hash := archauth.Hash(token)
	repo := &fakeRepository{componentSession: map[string]store.ComponentSession{
		hash: {
			TokenHash: hash, Audience: componentAudience,
			Scopes: []string{"checkout:create"}, AllowedOrigin: "https://shop.example",
			ExpiresAt: time.Now().Add(time.Minute),
		},
	}}
	server := NewServer(config.Config{Env: "dev"}, repo, slog.Default())

	request := httptest.NewRequest(http.MethodPost, "/", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Origin", "https://attacker.example")
	recorder := httptest.NewRecorder()
	if _, ok := server.authenticateComponentSession(recorder, request, "checkout:create"); ok || recorder.Code != http.StatusForbidden {
		t.Fatalf("wrong origin status = %d, want 403", recorder.Code)
	}

	request.Header.Set("Origin", "https://shop.example")
	recorder = httptest.NewRecorder()
	if _, ok := server.authenticateComponentSession(recorder, request, "profile:read"); ok || recorder.Code != http.StatusForbidden {
		t.Fatalf("wrong scope status = %d, want 403", recorder.Code)
	}

	session := repo.componentSession[hash]
	session.ExpiresAt = time.Now().Add(-time.Minute)
	repo.componentSession[hash] = session
	recorder = httptest.NewRecorder()
	if _, ok := server.authenticateComponentSession(recorder, request, "checkout:create"); ok || recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expired token status = %d, want 401", recorder.Code)
	}
}

func TestProductionOriginsRequireHTTPS(t *testing.T) {
	if validOrigins([]string{"http://shop.example"}, "prod") {
		t.Fatal("production origins must require HTTPS")
	}
	if !validOrigins([]string{"https://shop.example"}, "prod") {
		t.Fatal("valid HTTPS origin should be accepted")
	}
}

func TestEdgeAndOrganizationAuthenticationAreIndependent(t *testing.T) {
	serviceKey := "svc_test_0123456789012345678901234567890123456789012"
	server := NewServer(config.Config{
		Env: "dev", RequireEdgeAuth: true, CoreServiceKey: serviceKey,
	}, &fakeRepository{}, slog.Default())

	missingService := httptest.NewRequest(http.MethodPost, "/v1/components", strings.NewReader(`{}`))
	missingService.Header.Set("Authorization", "Bearer "+testAdminKey)
	missingServiceRecorder := httptest.NewRecorder()
	server.Router().ServeHTTP(missingServiceRecorder, missingService)
	if missingServiceRecorder.Code != http.StatusUnauthorized || !strings.Contains(missingServiceRecorder.Body.String(), "invalid_service_key") {
		t.Fatalf("missing service status = %d, body = %s", missingServiceRecorder.Code, missingServiceRecorder.Body.String())
	}

	missingOrganization := httptest.NewRequest(http.MethodPost, "/v1/components", strings.NewReader(`{}`))
	missingOrganization.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	missingOrganizationRecorder := httptest.NewRecorder()
	server.Router().ServeHTTP(missingOrganizationRecorder, missingOrganization)
	if missingOrganizationRecorder.Code != http.StatusUnauthorized || !strings.Contains(missingOrganizationRecorder.Body.String(), "invalid_api_key") {
		t.Fatalf("missing organization status = %d, body = %s", missingOrganizationRecorder.Code, missingOrganizationRecorder.Body.String())
	}
}

func TestEdgeAuthenticationRejectsEnvironmentMismatch(t *testing.T) {
	server := NewServer(config.Config{
		Env: "prod", RequireEdgeAuth: true,
		CoreServiceKey: "svc_live_0123456789012345678901234567890123456789012",
	}, &fakeRepository{}, slog.Default())
	request := httptest.NewRequest(http.MethodPost, "/v1/clients", strings.NewReader(`{}`))
	request.Header.Set(serviceAuthorizationHeader, "Bearer svc_test_0123456789012345678901234567890123456789012")
	recorder := httptest.NewRecorder()
	server.Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized || !strings.Contains(recorder.Body.String(), "invalid_service_key") {
		t.Fatalf("mismatched service key status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestProductionOrganizationRateLimitReturnsRetryAfter(t *testing.T) {
	serviceKey := "svc_live_0123456789012345678901234567890123456789012"
	organizationKey := "sk_live_0123456789012345678901234567890123456789012"
	repo := &fakeRepository{
		organization: store.Organization{ID: "organization-a", Status: "active", AllowedOrigins: []string{"http://localhost:5173"}},
		secretHash:   archauth.Hash(organizationKey), rateLimitDenied: true,
	}
	server := NewServer(config.Config{
		Env: "prod", RequireEdgeAuth: true, CoreServiceKey: serviceKey,
	}, repo, slog.Default())
	request := httptest.NewRequest(http.MethodPost, "/v1/components", strings.NewReader(`{}`))
	request.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	request.Header.Set("Authorization", "Bearer "+organizationKey)
	recorder := httptest.NewRecorder()
	server.Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "42" {
		t.Fatalf("rate limit status = %d, retry-after = %q, body = %s", recorder.Code, recorder.Header().Get("Retry-After"), recorder.Body.String())
	}
}

func TestDevelopmentBypassesRateLimitsWithEdgeAuthEnabled(t *testing.T) {
	serviceKey := "svc_test_0123456789012345678901234567890123456789012"
	organizationKey := "sk_test_0123456789012345678901234567890123456789012"
	repo := &fakeRepository{
		organization: store.Organization{ID: "organization-a", Status: "active", AllowedOrigins: []string{"http://localhost:5173"}},
		secretHash:   archauth.Hash(organizationKey), rateLimitDenied: true,
	}
	server := NewServer(config.Config{
		Env: "dev", RequireEdgeAuth: true, CoreServiceKey: serviceKey,
	}, repo, slog.Default())
	request := httptest.NewRequest(http.MethodPost, "/v1/components", strings.NewReader(`{}`))
	request.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	request.Header.Set("Authorization", "Bearer "+organizationKey)
	recorder := httptest.NewRecorder()
	server.Router().ServeHTTP(recorder, request)
	if recorder.Code == http.StatusTooManyRequests || len(repo.rateLimitCalls) != 0 {
		t.Fatalf("development request was rate limited: status=%d calls=%+v body=%s", recorder.Code, repo.rateLimitCalls, recorder.Body.String())
	}
}

func performRequest(handler http.Handler, method, path, body, bearer string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

var _ repository = (*fakeRepository)(nil)
