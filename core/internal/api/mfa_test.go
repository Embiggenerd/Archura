package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"testing"
	"time"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/config"
	"github.com/archura/core/internal/store"
	"github.com/archura/core/internal/totp"
)

// prodAdminSession mints a prod-env session for the staff account so a prod
// server accepts it (the shared helper mints a dev token).
func prodAdminSession(t *testing.T, repository *adminTestRepository) string {
	t.Helper()
	token, err := archauth.Generate("sess", "prod")
	if err != nil {
		t.Fatal(err)
	}
	repository.accountSessions[archauth.Hash(token)] = store.AccountSession{
		ID: "staff-session-prod", AccountID: "staff-account",
		ExpiresAt: time.Now().Add(time.Hour), CreatedAt: time.Now().UTC(),
	}
	return token
}

// In prod, sensitive admin routes require step-up MFA: enroll, activate with a
// valid code (which elevates), then the routes open; once elevation lapses a
// fresh verify is needed. Dev is covered elsewhere (no step-up).
func TestAdminMFAStepUpFlowInProd(t *testing.T) {
	repository, _ := newAdminTestRepository(t, "platform_owner")
	server := NewServer(config.Config{Env: "prod", AdminAPIEnabled: true}, repository, slog.Default())
	token := prodAdminSession(t, repository)
	router := server.Router()

	// Not yet enrolled → sensitive route demands enrollment.
	before := performRequest(router, http.MethodGet, "/v1/admin/organizations", "", token)
	if before.Code != http.StatusForbidden || !containsJSON(before.Body.String(), "mfa_enrollment_required") {
		t.Fatalf("pre-enroll status=%d body=%s", before.Code, before.Body.String())
	}

	// Enroll → secret.
	enroll := performRequest(router, http.MethodPost, "/v1/admin/mfa/enroll", "", token)
	if enroll.Code != http.StatusOK {
		t.Fatalf("enroll status=%d body=%s", enroll.Code, enroll.Body.String())
	}
	var enrolled struct {
		Secret string `json:"secret"`
	}
	if err := json.Unmarshal(enroll.Body.Bytes(), &enrolled); err != nil || enrolled.Secret == "" {
		t.Fatalf("enroll body=%s err=%v", enroll.Body.String(), err)
	}

	// A wrong code is rejected.
	bad := performRequest(router, http.MethodPost, "/v1/admin/mfa/activate", `{"code":"000000"}`, token)
	if bad.Code != http.StatusUnauthorized {
		t.Fatalf("bad activate status=%d body=%s", bad.Code, bad.Body.String())
	}

	// Activate with the real code → elevates the session.
	code, err := totp.Code(enrolled.Secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	activate := performRequest(router, http.MethodPost, "/v1/admin/mfa/activate", `{"code":"`+code+`"}`, token)
	if activate.Code != http.StatusOK {
		t.Fatalf("activate status=%d body=%s", activate.Code, activate.Body.String())
	}

	// Sensitive route now open.
	open := performRequest(router, http.MethodGet, "/v1/admin/organizations", "", token)
	if open.Code != http.StatusOK {
		t.Fatalf("elevated read status=%d body=%s", open.Code, open.Body.String())
	}

	// Elevation lapses → route demands a fresh step-up.
	for hash := range repository.sessionElevated {
		past := time.Now().Add(-time.Minute)
		repository.sessionElevated[hash] = &past
	}
	lapsed := performRequest(router, http.MethodGet, "/v1/admin/organizations", "", token)
	if lapsed.Code != http.StatusForbidden || !containsJSON(lapsed.Body.String(), "mfa_required") {
		t.Fatalf("lapsed status=%d body=%s", lapsed.Code, lapsed.Body.String())
	}

	// Step-up verify re-elevates.
	verifyCode, err := totp.Code(enrolled.Secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	verify := performRequest(router, http.MethodPost, "/v1/admin/mfa/verify", `{"code":"`+verifyCode+`"}`, token)
	if verify.Code != http.StatusOK {
		t.Fatalf("verify status=%d body=%s", verify.Code, verify.Body.String())
	}
	reopen := performRequest(router, http.MethodGet, "/v1/admin/organizations", "", token)
	if reopen.Code != http.StatusOK {
		t.Fatalf("reopen status=%d body=%s", reopen.Code, reopen.Body.String())
	}
}

// context reports enrollment/elevation so the console knows what to prompt.
func TestAdminContextReportsMFAState(t *testing.T) {
	repository, _ := newAdminTestRepository(t, "platform_owner")
	server := NewServer(config.Config{Env: "prod", AdminAPIEnabled: true}, repository, slog.Default())
	token := prodAdminSession(t, repository)
	router := server.Router()

	ctx := performRequest(router, http.MethodGet, "/v1/admin/context", "", token)
	if ctx.Code != http.StatusOK {
		t.Fatalf("context status=%d body=%s", ctx.Code, ctx.Body.String())
	}
	if !containsJSON(ctx.Body.String(), `"mfa_required":true`) || !containsJSON(ctx.Body.String(), `"mfa_enrolled":false`) {
		t.Fatalf("context body=%s", ctx.Body.String())
	}
}
