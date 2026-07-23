package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/config"
	"github.com/archura/core/internal/store"
)

type failFirstInvitationDelivery struct {
	attempts int
}

func (d *failFirstInvitationDelivery) deliverConfirmation(context.Context, pendingConfirmation) error {
	return nil
}

func (d *failFirstInvitationDelivery) deliverInvitation(context.Context, pendingInvitationEmail) error {
	d.attempts++
	if d.attempts == 1 {
		return errors.New("temporary email provider failure")
	}
	return nil
}

func (*failFirstInvitationDelivery) consumed(string) {}

func TestConfirmationAccountSessionAndOwnershipContract(t *testing.T) {
	repo := &fakeRepository{}
	server := NewServer(config.Config{
		Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm",
	}, repo, slog.Default())
	router := server.Router()

	created := performRequest(router, http.MethodPost, "/v1/confirmations", `{
		"email":"  Owner@Example.COM "
	}`, "")
	if created.Code != http.StatusCreated || created.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("create confirmation status = %d, body = %s", created.Code, created.Body.String())
	}
	var createBody struct {
		ID         string    `json:"id"`
		ExpiresAt  time.Time `json:"expires_at"`
		ConfirmURL string    `json:"confirm_url"`
	}
	if err := json.NewDecoder(created.Body).Decode(&createBody); err != nil {
		t.Fatal(err)
	}
	parsedURL, err := url.Parse(createBody.ConfirmURL)
	if err != nil {
		t.Fatal(err)
	}
	token := parsedURL.Query().Get("token")
	if createBody.ID == "" || !createBody.ExpiresAt.After(time.Now()) || !strings.HasPrefix(token, "cfm_test_") {
		t.Fatalf("unexpected create response: %+v", createBody)
	}
	for hash, confirmation := range repo.confirmations {
		if hash == token || hash != archauth.Hash(token) || confirmation.Email != "owner@example.com" {
			t.Fatalf("confirmation was not normalized and hash-only: hash=%q confirmation=%+v", hash, confirmation)
		}
	}

	mailbox := performRequest(router, http.MethodGet, "/v1/dev/confirmations", "", "")
	if mailbox.Code != http.StatusOK || !strings.Contains(mailbox.Body.String(), createBody.ConfirmURL) {
		t.Fatalf("mailbox status = %d, body = %s", mailbox.Code, mailbox.Body.String())
	}

	verified := performRequest(router, http.MethodPost, "/v1/confirmations/verify", `{"token":"`+token+`"}`, "")
	if verified.Code != http.StatusOK || verified.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("verify status = %d, body = %s", verified.Code, verified.Body.String())
	}
	var verifyBody struct {
		Account struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"account"`
		Organization struct {
			ID             string `json:"id"`
			PublishableKey string `json:"publishable_key"`
			IsDefault      bool   `json:"is_default"`
		} `json:"organization"`
		Subdomain *string `json:"subdomain"`
		Session   struct {
			Token     string    `json:"token"`
			ExpiresAt time.Time `json:"expires_at"`
		} `json:"session"`
	}
	if err := json.NewDecoder(verified.Body).Decode(&verifyBody); err != nil {
		t.Fatal(err)
	}
	if verifyBody.Account.Email != "owner@example.com" || verifyBody.Subdomain != nil ||
		verifyBody.Organization.ID == "" || !verifyBody.Organization.IsDefault ||
		!strings.HasPrefix(verifyBody.Organization.PublishableKey, "pk_test_") ||
		!strings.HasPrefix(verifyBody.Session.Token, "sess_test_") || !verifyBody.Session.ExpiresAt.After(time.Now().Add(6*24*time.Hour)) {
		t.Fatalf("unexpected verify response: %+v", verifyBody)
	}
	if mailbox = performRequest(router, http.MethodGet, "/v1/dev/confirmations", "", ""); mailbox.Code != http.StatusOK ||
		!strings.Contains(mailbox.Body.String(), token) || !strings.Contains(mailbox.Body.String(), `"used":true`) {
		t.Fatalf("used confirmation was not retained and marked: %s", mailbox.Body.String())
	}

	me := performRequest(router, http.MethodGet, "/v1/sessions/me", "", verifyBody.Session.Token)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), `"organizations"`) || !strings.Contains(me.Body.String(), `"sites":[]`) {
		t.Fatalf("session me status = %d, body = %s", me.Code, me.Body.String())
	}
	createdOrganization := performRequest(router, http.MethodPost, "/v1/organizations", `{
		"name":"Second Business","slug":"second-business"
	}`, verifyBody.Session.Token)
	if createdOrganization.Code != http.StatusCreated ||
		!strings.Contains(createdOrganization.Body.String(), `"secret_key":"sk_test_`) ||
		!strings.Contains(createdOrganization.Body.String(), `"is_default":false`) {
		t.Fatalf("create organization status = %d, body = %s", createdOrganization.Code, createdOrganization.Body.String())
	}
	var organizationBody struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(createdOrganization.Body).Decode(&organizationBody); err != nil {
		t.Fatal(err)
	}
	organizationSite := performRequest(router, http.MethodPost, "/v1/site-ownership", `{
		"subdomain":"organization-site","organization_id":"`+organizationBody.ID+`"
	}`, verifyBody.Session.Token)
	if organizationSite.Code != http.StatusCreated || !strings.Contains(organizationSite.Body.String(), organizationBody.ID) {
		t.Fatalf("organization site bind status = %d, body = %s", organizationSite.Code, organizationSite.Body.String())
	}
	bound := performRequest(router, http.MethodPost, "/v1/site-ownership", `{"subdomain":"mikes-bakery"}`, verifyBody.Session.Token)
	if bound.Code != http.StatusCreated || !strings.Contains(bound.Body.String(), verifyBody.Organization.ID) {
		t.Fatalf("bind site status = %d, body = %s", bound.Code, bound.Body.String())
	}
	idempotent := performRequest(router, http.MethodPost, "/v1/site-ownership", `{"subdomain":"mikes-bakery"}`, verifyBody.Session.Token)
	if idempotent.Code != http.StatusCreated {
		t.Fatalf("idempotent bind status = %d, body = %s", idempotent.Code, idempotent.Body.String())
	}
	secondSite := performRequest(router, http.MethodPost, "/v1/site-ownership", `{"subdomain":"second-site"}`, verifyBody.Session.Token)
	if secondSite.Code != http.StatusCreated {
		t.Fatalf("second site bind status = %d, body = %s", secondSite.Code, secondSite.Body.String())
	}
	me = performRequest(router, http.MethodGet, "/v1/sessions/me", "", verifyBody.Session.Token)
	if me.Code != http.StatusOK || !strings.Contains(me.Body.String(), "mikes-bakery") ||
		!strings.Contains(me.Body.String(), "second-site") || !strings.Contains(me.Body.String(), "organization-site") ||
		!strings.Contains(me.Body.String(), "Second Business") {
		t.Fatalf("session sites were not updated: %s", me.Body.String())
	}

	reused := performRequest(router, http.MethodPost, "/v1/confirmations/verify", `{"token":"`+token+`"}`, "")
	if reused.Code != http.StatusUnauthorized || !strings.Contains(reused.Body.String(), "invalid_token") {
		t.Fatalf("reused confirmation status = %d, body = %s", reused.Code, reused.Body.String())
	}
	logout := performRequest(router, http.MethodPost, "/v1/sessions/logout", "", verifyBody.Session.Token)
	if logout.Code != http.StatusNoContent || logout.Body.Len() != 0 || logout.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("logout status = %d, body = %s", logout.Code, logout.Body.String())
	}
	if session := repo.accountSessions[archauth.Hash(verifyBody.Session.Token)]; session.RevokedAt == nil {
		t.Fatal("logout did not revoke the account session")
	}
	loggedOutSession := performRequest(router, http.MethodGet, "/v1/sessions/me", "", verifyBody.Session.Token)
	if loggedOutSession.Code != http.StatusUnauthorized {
		t.Fatalf("revoked account session status = %d, body = %s", loggedOutSession.Code, loggedOutSession.Body.String())
	}
	for _, bearer := range []string{verifyBody.Session.Token, "sess_test_unknown", ""} {
		response := performRequest(router, http.MethodPost, "/v1/sessions/logout", "", bearer)
		if response.Code != http.StatusNoContent {
			t.Fatalf("idempotent logout for %q status = %d, body = %s", bearer, response.Code, response.Body.String())
		}
	}
}

func TestOrganizationInvitationRequiresOwnerAndMatchingVerifiedEmail(t *testing.T) {
	now := time.Now().UTC()
	ownerToken := "sess_test_0123456789012345678901234567890123456789012"
	memberToken := "sess_test_1123456789012345678901234567890123456789012"
	otherToken := "sess_test_2123456789012345678901234567890123456789012"
	owner := store.Account{ID: "account-owner", Email: "owner@example.com", EmailVerifiedAt: &now, CreatedAt: now}
	member := store.Account{ID: "account-member", Email: "member@example.com", EmailVerifiedAt: &now, CreatedAt: now}
	other := store.Account{ID: "account-other", Email: "other@example.com", EmailVerifiedAt: &now, CreatedAt: now}
	repo := &fakeRepository{
		accounts:       map[string]store.Account{owner.ID: owner, member.ID: member, other.ID: other},
		accountByEmail: map[string]string{owner.Email: owner.ID, member.Email: member.ID, other.Email: other.ID},
		accountSessions: map[string]store.AccountSession{
			archauth.Hash(ownerToken):  {AccountID: owner.ID, ExpiresAt: now.Add(time.Hour)},
			archauth.Hash(memberToken): {AccountID: member.ID, ExpiresAt: now.Add(time.Hour)},
			archauth.Hash(otherToken):  {AccountID: other.ID, ExpiresAt: now.Add(time.Hour)},
		},
		organizations: map[string][]store.AccountOrganization{
			owner.ID: {{
				Organization: store.Organization{ID: "organization-one", Name: "Acme Bakery", Status: "active", CreatedAt: now},
				Role:         "owner", IsDefault: true, Sites: []string{},
			}},
		},
	}
	server := NewServer(config.Config{Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm"}, repo, slog.Default())
	router := server.Router()

	repo.invitationCreateErr = store.ErrConflict
	alreadyInvited := performRequest(router, http.MethodPost, "/v1/organizations/organization-one/invitations", `{"email":"member@example.com"}`, ownerToken)
	if alreadyInvited.Code != http.StatusConflict ||
		!strings.Contains(alreadyInvited.Body.String(), `"code":"already_invited"`) ||
		strings.Contains(alreadyInvited.Body.String(), "already a member") {
		t.Fatalf("pending-invitation conflict status=%d body=%s", alreadyInvited.Code, alreadyInvited.Body.String())
	}
	repo.invitationCreateErr = nil

	created := performRequest(router, http.MethodPost, "/v1/organizations/organization-one/invitations", `{"email":" MEMBER@Example.com "}`, ownerToken)
	if created.Code != http.StatusCreated || !strings.Contains(created.Body.String(), `"email":"member@example.com"`) {
		t.Fatalf("create invitation status=%d body=%s", created.Code, created.Body.String())
	}
	var invitation struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(created.Body).Decode(&invitation); err != nil || invitation.ID == "" {
		t.Fatalf("decode invitation: id=%q err=%v", invitation.ID, err)
	}
	resent := performRequest(router, http.MethodPost, "/v1/organizations/organization-one/invitations", `{"email":"member@example.com"}`, ownerToken)
	var resentInvitation struct {
		ID string `json:"id"`
	}
	if resent.Code != http.StatusCreated || json.NewDecoder(resent.Body).Decode(&resentInvitation) != nil ||
		resentInvitation.ID != invitation.ID || len(repo.invitations) != 1 {
		t.Fatalf("resend invitation status=%d id=%q invitations=%d body=%s",
			resent.Code, resentInvitation.ID, len(repo.invitations), resent.Body.String())
	}

	mailbox := performRequest(router, http.MethodGet, "/v1/dev/confirmations", "", "")
	if mailbox.Code != http.StatusOK || !strings.Contains(mailbox.Body.String(), `"invitations"`) ||
		!strings.Contains(mailbox.Body.String(), "member@example.com") {
		t.Fatalf("invitation mailbox status=%d body=%s", mailbox.Code, mailbox.Body.String())
	}

	memberMe := performRequest(router, http.MethodGet, "/v1/sessions/me", "", memberToken)
	if memberMe.Code != http.StatusOK || !strings.Contains(memberMe.Body.String(), invitation.ID) ||
		!strings.Contains(memberMe.Body.String(), `"email_verified_at"`) {
		t.Fatalf("member invitation listing status=%d body=%s", memberMe.Code, memberMe.Body.String())
	}

	wrongAccount := performRequest(router, http.MethodPost, "/v1/invitations/"+invitation.ID+"/accept", "", otherToken)
	if wrongAccount.Code != http.StatusNotFound {
		t.Fatalf("wrong-account acceptance status=%d body=%s", wrongAccount.Code, wrongAccount.Body.String())
	}
	unverifiedMember := repo.accounts[member.ID]
	unverifiedMember.EmailVerifiedAt = nil
	repo.accounts[member.ID] = unverifiedMember
	unverified := performRequest(router, http.MethodPost, "/v1/invitations/"+invitation.ID+"/accept", "", memberToken)
	if unverified.Code != http.StatusNotFound {
		t.Fatalf("unverified-account acceptance status=%d body=%s", unverified.Code, unverified.Body.String())
	}
	repo.accounts[member.ID] = member

	accepted := performRequest(router, http.MethodPost, "/v1/invitations/"+invitation.ID+"/accept", "", memberToken)
	if accepted.Code != http.StatusOK || !strings.Contains(accepted.Body.String(), `"status":"accepted"`) {
		t.Fatalf("accept invitation status=%d body=%s", accepted.Code, accepted.Body.String())
	}
	memberMe = performRequest(router, http.MethodGet, "/v1/sessions/me", "", memberToken)
	if memberMe.Code != http.StatusOK || !strings.Contains(memberMe.Body.String(), "Acme Bakery") ||
		!strings.Contains(memberMe.Body.String(), `"invitations":[]`) {
		t.Fatalf("accepted membership status=%d body=%s", memberMe.Code, memberMe.Body.String())
	}
	existingMember := performRequest(router, http.MethodPost, "/v1/organizations/organization-one/invitations", `{"email":"member@example.com"}`, ownerToken)
	if existingMember.Code != http.StatusConflict || !strings.Contains(existingMember.Body.String(), `"code":"already_member"`) {
		t.Fatalf("existing-member invite status=%d body=%s", existingMember.Code, existingMember.Body.String())
	}

	nonOwner := performRequest(router, http.MethodPost, "/v1/organizations/organization-one/invitations", `{"email":"new@example.com"}`, memberToken)
	if nonOwner.Code != http.StatusNotFound {
		t.Fatalf("member invite status=%d body=%s", nonOwner.Code, nonOwner.Body.String())
	}
}

func TestOrganizationInvitationDeliveryFailureCanRetrySameInvitation(t *testing.T) {
	now := time.Now().UTC()
	ownerToken := "sess_test_3123456789012345678901234567890123456789012"
	owner := store.Account{ID: "account-owner", Email: "owner@example.com", EmailVerifiedAt: &now, CreatedAt: now}
	repo := &fakeRepository{
		accounts:       map[string]store.Account{owner.ID: owner},
		accountByEmail: map[string]string{owner.Email: owner.ID},
		accountSessions: map[string]store.AccountSession{
			archauth.Hash(ownerToken): {AccountID: owner.ID, ExpiresAt: now.Add(time.Hour)},
		},
		organizations: map[string][]store.AccountOrganization{
			owner.ID: {{
				Organization: store.Organization{ID: "organization-one", Name: "Acme Bakery", Status: "active", CreatedAt: now},
				Role:         "owner", IsDefault: true, Sites: []string{},
			}},
		},
	}
	server := NewServer(config.Config{Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm"}, repo, slog.Default())
	delivery := &failFirstInvitationDelivery{}
	server.delivery = delivery
	router := server.Router()

	failed := performRequest(router, http.MethodPost, "/v1/organizations/organization-one/invitations", `{"email":"member@example.com"}`, ownerToken)
	if failed.Code != http.StatusBadGateway || !strings.Contains(failed.Body.String(), `"code":"email_delivery_failed"`) ||
		len(repo.invitations) != 1 {
		t.Fatalf("failed delivery status=%d invitations=%d body=%s", failed.Code, len(repo.invitations), failed.Body.String())
	}
	var invitationID string
	for id := range repo.invitations {
		invitationID = id
	}

	retried := performRequest(router, http.MethodPost, "/v1/organizations/organization-one/invitations", `{"email":"member@example.com"}`, ownerToken)
	var invitation struct {
		ID string `json:"id"`
	}
	if retried.Code != http.StatusCreated || json.NewDecoder(retried.Body).Decode(&invitation) != nil ||
		invitation.ID != invitationID || delivery.attempts != 2 || len(repo.invitations) != 1 {
		t.Fatalf("retry status=%d id=%q attempts=%d invitations=%d body=%s",
			retried.Code, invitation.ID, delivery.attempts, len(repo.invitations), retried.Body.String())
	}
}

func TestFunnelConfirmationRejectsExistingEmail(t *testing.T) {
	account := store.Account{ID: "account-1", Email: "owner@example.com", CreatedAt: time.Now()}
	repo := &fakeRepository{
		accounts:       map[string]store.Account{"account-1": account},
		accountByEmail: map[string]string{"owner@example.com": "account-1"},
	}
	server := NewServer(config.Config{Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm"}, repo, slog.Default())
	router := server.Router()

	existing := performRequest(router, http.MethodPost, "/v1/confirmations",
		`{"email":" Owner@Example.com ","subdomain":"second-site"}`, "")
	if existing.Code != http.StatusConflict ||
		!strings.Contains(existing.Body.String(), `"code":"account_exists"`) ||
		len(repo.confirmations) != 0 {
		t.Fatalf("existing funnel confirmation status=%d confirmations=%d body=%s",
			existing.Code, len(repo.confirmations), existing.Body.String())
	}
	if repo.accountByEmailCalls != 1 {
		t.Fatalf("existing funnel account lookups = %d, want 1", repo.accountByEmailCalls)
	}

	signIn := performRequest(router, http.MethodPost, "/v1/confirmations",
		`{"email":"owner@example.com"}`, "")
	if signIn.Code != http.StatusCreated || repo.accountByEmailCalls != 1 {
		t.Fatalf("existing sign-in confirmation status=%d lookups=%d body=%s",
			signIn.Code, repo.accountByEmailCalls, signIn.Body.String())
	}

	newFunnel := performRequest(router, http.MethodPost, "/v1/confirmations",
		`{"email":"new@example.com","subdomain":"new-site"}`, "")
	if newFunnel.Code != http.StatusCreated || repo.accountByEmailCalls != 2 {
		t.Fatalf("new funnel confirmation status=%d lookups=%d body=%s",
			newFunnel.Code, repo.accountByEmailCalls, newFunnel.Body.String())
	}
}

func TestFunnelAccountLookupRunsAfterRateLimitsAndFailsClosed(t *testing.T) {
	t.Run("rate limited", func(t *testing.T) {
		repo := &fakeRepository{rateLimitDenied: true}
		server := NewServer(config.Config{Env: "prod"}, repo, slog.Default())
		response := performRequest(server.Router(), http.MethodPost, "/v1/confirmations",
			`{"email":"owner@example.com","subdomain":"new-site"}`, "")
		if response.Code != http.StatusTooManyRequests || repo.accountByEmailCalls != 0 {
			t.Fatalf("status=%d account lookups=%d body=%s",
				response.Code, repo.accountByEmailCalls, response.Body.String())
		}
	})

	t.Run("lookup error", func(t *testing.T) {
		repo := &fakeRepository{accountByEmailErr: errors.New("database unavailable")}
		server := NewServer(config.Config{Env: "prod"}, repo, slog.Default())
		response := performRequest(server.Router(), http.MethodPost, "/v1/confirmations",
			`{"email":"owner@example.com","subdomain":"new-site"}`, "")
		if response.Code != http.StatusInternalServerError ||
			repo.accountByEmailCalls != 1 || len(repo.confirmations) != 0 {
			t.Fatalf("status=%d account lookups=%d confirmations=%d body=%s",
				response.Code, repo.accountByEmailCalls, len(repo.confirmations), response.Body.String())
		}
	})
}

func TestSessionMeReportsSiteSlotsRemaining(t *testing.T) {
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	trialEnd := now.Add(-time.Hour)
	graceEnd := now.Add(time.Hour)
	token := "sess_test_3123456789012345678901234567890123456789012"
	account := store.Account{ID: "account-1", Email: "owner@example.com", CreatedAt: now}
	organizations := []store.AccountOrganization{
		{Organization: store.Organization{ID: "free", CreatedAt: now}, Role: "owner", IsDefault: true},
		{Organization: store.Organization{ID: "full", CreatedAt: now}, Role: "owner"},
		{Organization: store.Organization{ID: "paid", CreatedAt: now}, Role: "owner"},
		{Organization: store.Organization{ID: "exempt", CapsExempt: true, CreatedAt: now}, Role: "owner"},
		{Organization: store.Organization{ID: "read-only", CreatedAt: now}, Role: "owner"},
	}
	repo := &fakeRepository{
		accounts: map[string]store.Account{account.ID: account},
		accountSessions: map[string]store.AccountSession{
			archauth.Hash(token): {AccountID: account.ID, ExpiresAt: time.Now().Add(time.Hour)},
		},
		organizations: map[string][]store.AccountOrganization{account.ID: organizations},
		sites: map[string]string{
			"free-used": "free", "full-used": "full",
			"paid-one": "paid", "paid-two": "paid", "read-only-used": "read-only",
		},
		billing: map[string]store.OrganizationBilling{
			"free":      {FreeSiteLimit: 2, FreeNoExpiry: true},
			"full":      {FreeSiteLimit: 1, FreeNoExpiry: true},
			"paid":      {FreeSiteLimit: 1, StripeSubscriptionStatus: "active"},
			"exempt":    {FreeSiteLimit: 0},
			"read-only": {FreeSiteLimit: 3, TrialEndsAt: &trialEnd, ServeGraceEndsAt: &graceEnd},
		},
	}
	server := NewServer(config.Config{Env: "dev"}, repo, slog.Default())
	server.now = func() time.Time { return now }
	response := performRequest(server.Router(), http.MethodGet, "/v1/sessions/me", "", token)
	if response.Code != http.StatusOK {
		t.Fatalf("session status=%d body=%s", response.Code, response.Body.String())
	}
	var body struct {
		Organizations []struct {
			ID                 string          `json:"id"`
			SiteSlotsRemaining json.RawMessage `json:"site_slots_remaining"`
			Billing            struct {
				CanEdit bool `json:"can_edit"`
			} `json:"billing"`
		} `json:"organizations"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	expected := map[string]string{
		"free": "1", "full": "0", "paid": "1", "exempt": "null", "read-only": "2",
	}
	for _, organization := range body.Organizations {
		want, ok := expected[organization.ID]
		if !ok {
			t.Fatalf("unexpected organization %q", organization.ID)
		}
		if string(organization.SiteSlotsRemaining) != want {
			t.Fatalf("%s site_slots_remaining = %s, want %s",
				organization.ID, organization.SiteSlotsRemaining, want)
		}
		if organization.ID == "read-only" && organization.Billing.CanEdit {
			t.Fatal("read-only organization unexpectedly reports can_edit")
		}
		delete(expected, organization.ID)
	}
	if len(expected) != 0 {
		t.Fatalf("missing organizations: %v", expected)
	}

	shared := organizationResponse(organizations[0], now)
	if _, exists := shared["site_slots_remaining"]; exists {
		t.Fatal("shared organization response contains session-only capacity")
	}
}

func TestLogoutRemainsNoContentWhenRevocationFails(t *testing.T) {
	repo := &fakeRepository{revokeSessionErr: errors.New("database unavailable")}
	server := NewServer(config.Config{Env: "dev"}, repo, slog.Default())
	response := performRequest(server.Router(), http.MethodPost, "/v1/sessions/logout", "", "sess_test_known")
	if response.Code != http.StatusNoContent || response.Body.Len() != 0 {
		t.Fatalf("best-effort logout status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestConfirmationOwnershipConflictRollsBack(t *testing.T) {
	repo := &fakeRepository{sites: map[string]string{"taken-site": "other-account"}}
	server := NewServer(config.Config{Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm"}, repo, slog.Default())
	router := server.Router()
	created := performRequest(router, http.MethodPost, "/v1/confirmations", `{"email":"new@example.com","subdomain":"taken-site"}`, "")
	var body struct {
		ConfirmURL string `json:"confirm_url"`
	}
	if err := json.NewDecoder(created.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(body.ConfirmURL)
	token := parsed.Query().Get("token")
	response := performRequest(router, http.MethodPost, "/v1/confirmations/verify", `{"token":"`+token+`"}`, "")
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "site_owned") {
		t.Fatalf("ownership conflict status = %d, body = %s", response.Code, response.Body.String())
	}
	confirmation := repo.confirmations[archauth.Hash(token)]
	if confirmation.UsedAt != nil || len(repo.accounts) != 0 || len(repo.accountSessions) != 0 {
		t.Fatalf("ownership conflict left partial state: confirmation=%+v accounts=%v sessions=%v", confirmation, repo.accounts, repo.accountSessions)
	}
	mailbox := performRequest(router, http.MethodGet, "/v1/dev/confirmations", "", "")
	if !strings.Contains(mailbox.Body.String(), token) {
		t.Fatalf("conflicted unused confirmation left mailbox: %s", mailbox.Body.String())
	}
}

func TestConfirmationRejectsInvalidExpiredAndMissingConfig(t *testing.T) {
	repo := &fakeRepository{}
	missingConfig := NewServer(config.Config{Env: "dev"}, repo, slog.Default()).Router()
	response := performRequest(missingConfig, http.MethodPost, "/v1/confirmations", `{"email":"a@example.com"}`, "")
	if response.Code != http.StatusInternalServerError || len(repo.confirmations) != 0 {
		t.Fatalf("missing confirm base status = %d, body = %s", response.Code, response.Body.String())
	}

	server := NewServer(config.Config{Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm"}, repo, slog.Default())
	invalid := performRequest(server.Router(), http.MethodPost, "/v1/confirmations/verify", `{"token":"bad"}`, "")
	if invalid.Code != http.StatusUnauthorized {
		t.Fatalf("invalid token status = %d, body = %s", invalid.Code, invalid.Body.String())
	}
	expiredToken := "cfm_test_0123456789012345678901234567890123456789012"
	repo.confirmations = map[string]store.EmailConfirmation{
		archauth.Hash(expiredToken): {TokenHash: archauth.Hash(expiredToken), Email: "a@example.com", ExpiresAt: time.Now().Add(-time.Minute)},
	}
	expired := performRequest(server.Router(), http.MethodPost, "/v1/confirmations/verify", `{"token":"`+expiredToken+`"}`, "")
	if expired.Code != http.StatusUnauthorized {
		t.Fatalf("expired token status = %d, body = %s", expired.Code, expired.Body.String())
	}
}

func TestProductionHidesConfirmationURLAndDevMailbox(t *testing.T) {
	repo := &fakeRepository{}
	server := NewServer(config.Config{Env: "prod"}, repo, slog.Default())
	created := performRequest(server.Router(), http.MethodPost, "/v1/confirmations", `{"email":"owner@example.com"}`, "")
	if created.Code != http.StatusCreated || strings.Contains(created.Body.String(), "confirm_url") {
		t.Fatalf("production create status = %d, body = %s", created.Code, created.Body.String())
	}
	mailbox := performRequest(server.Router(), http.MethodGet, "/v1/dev/confirmations", "", "")
	if mailbox.Code != http.StatusNotFound {
		t.Fatalf("production mailbox status = %d, body = %s", mailbox.Code, mailbox.Body.String())
	}
}

func TestConfirmationRateLimitsUseEmailAndTrustedIPHourly(t *testing.T) {
	serviceKey := "svc_live_0123456789012345678901234567890123456789012"
	repo := &fakeRepository{}
	server := NewServer(config.Config{
		Env:             "prod",
		RequireEdgeAuth: true, CoreServiceKey: serviceKey,
	}, repo, slog.Default())
	request := httptest.NewRequest(http.MethodPost, "/v1/confirmations", strings.NewReader(`{"email":"Owner@Example.com"}`))
	request.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	request.Header.Set(trustedClientIPHeader, "203.0.113.9")
	recorder := httptest.NewRecorder()
	server.Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if len(repo.rateLimitCalls) != 2 {
		t.Fatalf("rate limit calls = %+v", repo.rateLimitCalls)
	}
	if repo.rateLimitCalls[0].Window != time.Hour || repo.rateLimitCalls[0].Limit != 5 ||
		repo.rateLimitCalls[0].Subject != "email:"+archauth.Hash("owner@example.com") ||
		repo.rateLimitCalls[1].Window != time.Hour || repo.rateLimitCalls[1].Subject != "ip:203.0.113.9" {
		t.Fatalf("unexpected rate limit calls: %+v", repo.rateLimitCalls)
	}
	repo.rateLimitDenied = true
	denied := httptest.NewRequest(http.MethodPost, "/v1/confirmations", strings.NewReader(`{"email":"other@example.com"}`))
	denied.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	denied.Header.Set(trustedClientIPHeader, "203.0.113.10")
	deniedRecorder := httptest.NewRecorder()
	server.Router().ServeHTTP(deniedRecorder, denied)
	if deniedRecorder.Code != http.StatusTooManyRequests || deniedRecorder.Header().Get("Retry-After") != "42" || len(repo.rateLimitCalls) != 4 {
		t.Fatalf("denied confirmation rate limit: status=%d calls=%+v body=%s", deniedRecorder.Code, repo.rateLimitCalls, deniedRecorder.Body.String())
	}
}

func TestDevelopmentConfirmationBypassesRateLimitsWithEdgeAuth(t *testing.T) {
	serviceKey := "svc_test_0123456789012345678901234567890123456789012"
	repo := &fakeRepository{rateLimitDenied: true}
	server := NewServer(config.Config{
		Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm",
		RequireEdgeAuth: true, CoreServiceKey: serviceKey,
	}, repo, slog.Default())
	request := httptest.NewRequest(http.MethodPost, "/v1/confirmations", strings.NewReader(`{"email":"owner@example.com"}`))
	request.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	recorder := httptest.NewRecorder()
	server.Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated || len(repo.rateLimitCalls) != 0 {
		t.Fatalf("development confirmation was rate limited: status=%d calls=%+v body=%s", recorder.Code, repo.rateLimitCalls, recorder.Body.String())
	}
}

func TestDevOutboxRetainsStateAndCapsNewestFifty(t *testing.T) {
	outbox := newConfirmationOutbox()
	now := time.Now()
	for i := 0; i < 52; i++ {
		key := fmt.Sprintf("%02d", i)
		outbox.deliver(pendingConfirmation{
			TokenHash: key, ConfirmURL: "https://example/" + key, ExpiresAt: now.Add(time.Hour),
		})
	}
	entries := outbox.list(devMailboxLimit)
	if len(entries) != 50 || entries[0].ConfirmURL != "https://example/51" || entries[49].ConfirmURL != "https://example/02" {
		t.Fatalf("unexpected outbox order/cap: %+v", entries)
	}
	outbox.consumed(entries[0].TokenHash)
	afterConsume := outbox.list(devMailboxLimit)
	if len(afterConsume) != 50 || !afterConsume[0].Used {
		t.Fatalf("consumed outbox entry was removed or unmarked: %+v", afterConsume)
	}
	outbox.deliver(pendingConfirmation{TokenHash: "expired", ConfirmURL: "https://example/expired", ExpiresAt: now.Add(-time.Minute)})
	if newest := outbox.list(devMailboxLimit)[0]; newest.ConfirmURL != "https://example/expired" {
		t.Fatalf("expired outbox entry was not retained: %+v", newest)
	}
	server := NewServer(config.Config{Env: "dev"}, &fakeRepository{}, slog.Default())
	server.devOutbox.deliver(pendingConfirmation{
		TokenHash: "expired", ConfirmURL: "https://example/expired",
		ExpiresAt: now.Add(-time.Minute), CreatedAt: now.Add(-time.Hour),
	})
	mailbox := performRequest(server.Router(), http.MethodGet, "/v1/dev/confirmations", "", "")
	if mailbox.Code != http.StatusOK || !strings.Contains(mailbox.Body.String(), `"expired":true`) || !strings.Contains(mailbox.Body.String(), `"used":false`) {
		t.Fatalf("expired mailbox state status=%d body=%s", mailbox.Code, mailbox.Body.String())
	}
}
