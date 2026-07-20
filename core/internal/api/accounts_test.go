package api

import (
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

func TestAccountCanConfirmAdditionalSite(t *testing.T) {
	account := store.Account{ID: "account-1", Email: "owner@example.com", CreatedAt: time.Now()}
	repo := &fakeRepository{
		accounts:       map[string]store.Account{"account-1": account},
		accountByEmail: map[string]string{"owner@example.com": "account-1"},
		sites:          map[string]string{"first-site": "account-1"},
	}
	server := NewServer(config.Config{Env: "dev", ConfirmURLBase: "http://localhost:8787/confirm"}, repo, slog.Default())
	created := performRequest(server.Router(), http.MethodPost, "/v1/confirmations", `{"email":"owner@example.com","subdomain":"second-site"}`, "")
	if created.Code != http.StatusCreated {
		t.Fatalf("additional site confirmation status=%d body=%s", created.Code, created.Body.String())
	}
	var body struct {
		ConfirmURL string `json:"confirm_url"`
	}
	if err := json.NewDecoder(created.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(body.ConfirmURL)
	token := parsed.Query().Get("token")
	verified := performRequest(server.Router(), http.MethodPost, "/v1/confirmations/verify", `{"token":"`+token+`"}`, "")
	if verified.Code != http.StatusOK {
		t.Fatalf("verify additional site status=%d body=%s", verified.Code, verified.Body.String())
	}
	if confirmation := repo.confirmations[archauth.Hash(token)]; confirmation.UsedAt == nil {
		t.Fatalf("additional site confirmation was not consumed: %+v", confirmation)
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
