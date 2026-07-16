package api

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
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
	tenant           store.Tenant
	secretHash       string
	publishableKey   string
	component        store.PaymentComponent
	session          store.ComponentSession
	componentSession map[string]store.ComponentSession
	audits           []store.AuditEvent
	rateLimitDenied  bool
}

func (f *fakeRepository) Ping(context.Context) error { return nil }

func (f *fakeRepository) DBStats() telemetry.DBStats { return telemetry.DBStats{} }

func (f *fakeRepository) CreateTenant(_ context.Context, p store.CreateTenantParams, audit store.AuditEvent) (store.Tenant, error) {
	if f.tenant.ID != "" {
		return store.Tenant{}, store.ErrConflict
	}
	f.tenant = store.Tenant{
		ID: "00000000-0000-0000-0000-000000000001", Name: p.Name, Slug: p.Slug,
		AllowedOrigins: p.AllowedOrigins, Status: "active", CreatedAt: time.Now().UTC(),
	}
	f.secretHash = p.SecretKeyHash
	f.publishableKey = p.PublishableKey
	audit.TenantID = f.tenant.ID
	audit.ResourceID = f.tenant.ID
	f.audits = append(f.audits, audit)
	return f.tenant, nil
}

func (f *fakeRepository) TenantBySecretHash(_ context.Context, hash string) (store.Tenant, error) {
	if hash != f.secretHash {
		return store.Tenant{}, store.ErrNotFound
	}
	return f.tenant, nil
}

func (f *fakeRepository) UpsertPaymentComponent(_ context.Context, component store.PaymentComponent, audit store.AuditEvent) (store.PaymentComponent, error) {
	if f.component.ID != "" && f.component.TenantID != component.TenantID {
		return store.PaymentComponent{}, store.ErrNotFound
	}
	component.CreatedAt = time.Now().UTC()
	component.UpdatedAt = component.CreatedAt
	f.component = component
	f.audits = append(f.audits, audit)
	return component, nil
}

func (f *fakeRepository) PaymentComponentForTenant(_ context.Context, tenantID, componentID string) (store.PaymentComponent, error) {
	if f.component.ID != componentID || f.component.TenantID != tenantID || f.component.Status != "active" {
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

func (f *fakeRepository) ConsumeRateLimit(context.Context, string, string, int) (store.RateLimitResult, error) {
	return store.RateLimitResult{Allowed: !f.rateLimitDenied, Count: 1, RetryAfterSeconds: 42}, nil
}

func TestClientComponentAndSessionContract(t *testing.T) {
	repo := &fakeRepository{}
	server := NewServer(config.Config{Env: "dev", PlatformAdminKey: testAdminKey}, repo, slog.Default())
	router := server.Router()

	clientBody := `{
		"name":"Mike's Bakery",
		"slug":"mikes-bakery",
		"allowed_origins":["http://localhost:5173"]
	}`
	clientResponse := performRequest(router, http.MethodPost, "/v1/clients", clientBody, testAdminKey)
	if clientResponse.Code != http.StatusCreated {
		t.Fatalf("create client status = %d, body = %s", clientResponse.Code, clientResponse.Body.String())
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
		t.Fatal("tenant secret must be stored only as its hash")
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
	if repo.component.TenantID != repo.tenant.ID || repo.component.StripePriceID != "price_test_bread" {
		t.Fatal("component configuration was not bound to the authenticated tenant")
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
	if repo.session.TenantID != repo.tenant.ID || repo.session.ComponentID != createdComponent.ID ||
		len(repo.session.Scopes) != 1 || repo.session.Scopes[0] != "checkout:create" {
		t.Fatalf("component token has incorrect binding: %+v", repo.session)
	}
	if len(repo.audits) != 3 || repo.audits[0].Action != "client.created" ||
		repo.audits[1].Action != "component.created" || repo.audits[2].Action != "component_session.created" {
		t.Fatalf("unexpected audit sequence: %+v", repo.audits)
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

func TestComponentSessionRejectsCrossTenantComponent(t *testing.T) {
	secret := "sk_test_0123456789012345678901234567890123456789012"
	repo := &fakeRepository{
		tenant:     store.Tenant{ID: "tenant-a", Status: "active", AllowedOrigins: []string{"http://localhost:5173"}},
		secretHash: archauth.Hash(secret),
		component:  store.PaymentComponent{ID: testComponentID, TenantID: "tenant-b", Status: "active", AllowedOrigins: []string{"http://localhost:5173"}},
	}
	server := NewServer(config.Config{Env: "dev"}, repo, slog.Default())
	body := `{"component_id":"` + testComponentID + `","origin":"http://localhost:5173"}`
	response := performRequest(server.Router(), http.MethodPost, "/v1/component-sessions", body, secret)
	if response.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant mint status = %d, want 404; body = %s", response.Code, response.Body.String())
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

func TestEdgeAndTenantAuthenticationAreIndependent(t *testing.T) {
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

	missingTenant := httptest.NewRequest(http.MethodPost, "/v1/components", strings.NewReader(`{}`))
	missingTenant.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	missingTenantRecorder := httptest.NewRecorder()
	server.Router().ServeHTTP(missingTenantRecorder, missingTenant)
	if missingTenantRecorder.Code != http.StatusUnauthorized || !strings.Contains(missingTenantRecorder.Body.String(), "invalid_api_key") {
		t.Fatalf("missing tenant status = %d, body = %s", missingTenantRecorder.Code, missingTenantRecorder.Body.String())
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

func TestTenantRateLimitReturnsRetryAfter(t *testing.T) {
	serviceKey := "svc_test_0123456789012345678901234567890123456789012"
	tenantKey := "sk_test_0123456789012345678901234567890123456789012"
	repo := &fakeRepository{
		tenant:     store.Tenant{ID: "tenant-a", Status: "active", AllowedOrigins: []string{"http://localhost:5173"}},
		secretHash: archauth.Hash(tenantKey), rateLimitDenied: true,
	}
	server := NewServer(config.Config{
		Env: "dev", RequireEdgeAuth: true, CoreServiceKey: serviceKey,
	}, repo, slog.Default())
	request := httptest.NewRequest(http.MethodPost, "/v1/components", strings.NewReader(`{}`))
	request.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
	request.Header.Set("Authorization", "Bearer "+tenantKey)
	recorder := httptest.NewRecorder()
	server.Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "42" {
		t.Fatalf("rate limit status = %d, retry-after = %q, body = %s", recorder.Code, recorder.Header().Get("Retry-After"), recorder.Body.String())
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
