package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

func TestVerifyConfirmationIsSingleUseAndConflictRollsBack(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "accounts-test-" + suffix
	defer cleanupAccountFixtures(ctx, st, suffix, requestPrefix)

	site := "site-" + suffix
	confirmation, err := st.CreateConfirmation(ctx, EmailConfirmation{
		TokenHash: "confirmation-hash-" + suffix, Email: "owner-" + suffix + "@example.com",
		Subdomain: &site, ExpiresAt: time.Now().Add(time.Hour),
	}, AuditEvent{
		ActorType: "anonymous", Action: "confirmation.created", ResourceType: "confirmation",
		RequestID: requestPrefix + "-created", Metadata: EmptyAuditMetadata{},
	})
	if err != nil {
		t.Fatalf("create confirmation: %v", err)
	}

	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			_, err := st.VerifyConfirmation(ctx, VerifyConfirmationParams{
				TokenHash: confirmation.TokenHash, SessionTokenHash: fmt.Sprintf("session-hash-%s-%d", suffix, index),
				SessionExpiresAt: time.Now().Add(7 * 24 * time.Hour),
				PublishableKey:   fmt.Sprintf("pk-test-%s-%d", suffix, index),
				SecretKeyHash:    fmt.Sprintf("sk-hash-%s-%d", suffix, index),
				RequestID:        fmt.Sprintf("%s-verify-%d", requestPrefix, index),
			})
			results <- err
		}(i)
	}
	wg.Wait()
	close(results)
	successes, invalid := 0, 0
	for resultErr := range results {
		switch {
		case resultErr == nil:
			successes++
		case errors.Is(resultErr, ErrNotFound):
			invalid++
		default:
			t.Fatalf("unexpected concurrent verify error: %v", resultErr)
		}
	}
	if successes != 1 || invalid != 1 {
		t.Fatalf("concurrent verify results: successes=%d invalid=%d", successes, invalid)
	}
	account, err := st.AccountByEmail(ctx, confirmation.Email)
	if err != nil {
		t.Fatalf("find verified account: %v", err)
	}
	if err := st.BindSiteOwnership(ctx, "second-"+suffix, account.ID, AuditEvent{
		ActorType: "account", ActorID: account.ID, Action: "site_ownership.bound",
		ResourceType: "site", ResourceID: "second-" + suffix,
		RequestID: requestPrefix + "-second-bind", Metadata: EmptyAuditMetadata{},
	}); err != nil {
		t.Fatalf("second direct site bind: %v", err)
	}

	secondSite := "second-confirmation-" + suffix
	accountLimit, err := st.CreateConfirmation(ctx, EmailConfirmation{
		TokenHash: "account-limit-hash-" + suffix, Email: confirmation.Email,
		Subdomain: &secondSite, ExpiresAt: time.Now().Add(time.Hour),
	}, AuditEvent{
		ActorType: "anonymous", Action: "confirmation.created", ResourceType: "confirmation",
		RequestID: requestPrefix + "-account-limit-created", Metadata: EmptyAuditMetadata{},
	})
	if err != nil {
		t.Fatalf("create account-limit confirmation: %v", err)
	}
	_, err = st.VerifyConfirmation(ctx, VerifyConfirmationParams{
		TokenHash: accountLimit.TokenHash, SessionTokenHash: "account-limit-session-" + suffix,
		SessionExpiresAt: time.Now().Add(7 * 24 * time.Hour),
		PublishableKey:   "pk-account-limit-" + suffix, SecretKeyHash: "sk-account-limit-" + suffix,
		RequestID: requestPrefix + "-account-limit-verify",
	})
	if err != nil {
		t.Fatalf("additional-site verify: %v", err)
	}
	afterAccountLimit, err := st.ConfirmationByTokenHash(ctx, accountLimit.TokenHash)
	if err != nil || afterAccountLimit.UsedAt == nil {
		t.Fatalf("additional-site confirmation was not consumed: confirmation=%+v err=%v", afterAccountLimit, err)
	}

	conflictTokenHash := "conflict-confirmation-hash-" + suffix
	conflict, err := st.CreateConfirmation(ctx, EmailConfirmation{
		TokenHash: conflictTokenHash, Email: "other-" + suffix + "@example.com",
		Subdomain: &site, ExpiresAt: time.Now().Add(time.Hour),
	}, AuditEvent{
		ActorType: "anonymous", Action: "confirmation.created", ResourceType: "confirmation",
		RequestID: requestPrefix + "-conflict-created", Metadata: EmptyAuditMetadata{},
	})
	if err != nil {
		t.Fatalf("create conflicting confirmation: %v", err)
	}
	_, err = st.VerifyConfirmation(ctx, VerifyConfirmationParams{
		TokenHash: conflict.TokenHash, SessionTokenHash: "conflict-session-hash-" + suffix,
		SessionExpiresAt: time.Now().Add(7 * 24 * time.Hour),
		PublishableKey:   "pk-conflict-" + suffix, SecretKeyHash: "sk-conflict-" + suffix,
		RequestID: requestPrefix + "-conflict-verify",
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("conflicting verify error = %v, want ErrConflict", err)
	}
	afterConflict, err := st.ConfirmationByTokenHash(ctx, conflict.TokenHash)
	if err != nil || afterConflict.UsedAt != nil {
		t.Fatalf("conflicting confirmation was consumed: confirmation=%+v err=%v", afterConflict, err)
	}
	if _, err := st.AccountByEmail(ctx, conflict.Email); !errors.Is(err, ErrNotFound) {
		t.Fatalf("conflicting verify created account: %v", err)
	}
}

func TestAccountSessionExpiryAndMaintenance(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	requestPrefix := "maintenance-test-" + suffix
	defer cleanupAccountFixtures(ctx, st, suffix, requestPrefix)

	var accountID string
	if err := st.Pool.QueryRow(ctx, `INSERT INTO accounts (email) VALUES ($1) RETURNING id::text`, "maintenance-"+suffix+"@example.com").Scan(&accountID); err != nil {
		t.Fatalf("create maintenance account: %v", err)
	}
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES
		($1, $3::uuid, now() - interval '1 minute'),
		($2, $3::uuid, now() + interval '1 hour'),
		($4, $3::uuid, now() + interval '1 hour')`,
		"expired-session-"+suffix, "live-session-"+suffix, accountID, "revoked-session-"+suffix); err != nil {
		t.Fatalf("insert account sessions: %v", err)
	}
	if _, err := st.Pool.Exec(ctx, `
		INSERT INTO email_confirmations (token_hash, email, expires_at) VALUES
		($1, $3, now() - interval '1 minute'),
		($2, $3, now() + interval '1 hour')`,
		"expired-confirmation-"+suffix, "live-confirmation-"+suffix, "maintenance-"+suffix+"@example.com"); err != nil {
		t.Fatalf("insert confirmations: %v", err)
	}
	if _, err := st.SessionByTokenHash(ctx, "expired-session-"+suffix); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session lookup error = %v, want ErrNotFound", err)
	}
	for _, hash := range []string{"revoked-session-" + suffix, "revoked-session-" + suffix, "unknown-session-" + suffix} {
		if err := st.RevokeSessionByTokenHash(ctx, hash); err != nil {
			t.Fatalf("revoke session %q: %v", hash, err)
		}
	}
	if _, err := st.SessionByTokenHash(ctx, "revoked-session-"+suffix); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked session lookup error = %v, want ErrNotFound", err)
	}
	result, err := st.RunMaintenance(ctx)
	if err != nil {
		t.Fatalf("run maintenance: %v", err)
	}
	if result.AccountSessions < 2 || result.EmailConfirmations < 1 {
		t.Fatalf("maintenance result = %+v", result)
	}
	if _, err := st.SessionByTokenHash(ctx, "live-session-"+suffix); err != nil {
		t.Fatalf("live session was removed: %v", err)
	}
	if _, err := st.ConfirmationByTokenHash(ctx, "live-confirmation-"+suffix); err != nil {
		t.Fatalf("live confirmation was removed: %v", err)
	}
}

func TestConfigurableRateLimitWindow(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	subject := "rate-test-" + suffix
	defer func() {
		_, _ = st.Pool.Exec(ctx, `DELETE FROM rate_limit_buckets WHERE subject = $1`, subject)
	}()

	for i := 1; i <= 6; i++ {
		result, err := st.ConsumeRateLimit(ctx, subject, "confirmation.create.email", 5, time.Hour)
		if err != nil {
			t.Fatalf("consume rate limit %d: %v", i, err)
		}
		if result.Allowed != (i <= 5) {
			t.Fatalf("call %d allowed = %v", i, result.Allowed)
		}
	}
	if _, err := st.Pool.Exec(ctx, `UPDATE rate_limit_buckets SET window_start = window_start - interval '2 hours' WHERE subject = $1`, subject); err != nil {
		t.Fatalf("move rate window: %v", err)
	}
	reset, err := st.ConsumeRateLimit(ctx, subject, "confirmation.create.email", 5, time.Hour)
	if err != nil || !reset.Allowed || reset.Count != 1 {
		t.Fatalf("reset window result = %+v, err = %v", reset, err)
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run store integration tests")
	}
	st, err := Open(context.Background(), url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return st
}

func cleanupAccountFixtures(ctx context.Context, st *Store, suffix, requestPrefix string) {
	_, _ = st.Pool.Exec(ctx, `DELETE FROM audit_log WHERE request_id LIKE $1`, requestPrefix+"%")
	_, _ = st.Pool.Exec(ctx, `DELETE FROM email_confirmations WHERE email LIKE $1`, "%"+suffix+"@example.com")
	_, _ = st.Pool.Exec(ctx, `DELETE FROM accounts WHERE email LIKE $1`, "%"+suffix+"@example.com")
	_, _ = st.Pool.Exec(ctx, `DELETE FROM organizations WHERE name LIKE $1`, "%"+suffix+"%")
}
