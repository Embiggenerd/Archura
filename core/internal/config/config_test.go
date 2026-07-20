package config

import (
	"strings"
	"testing"
)

func TestDevelopmentDefaultsAllowScaffoldMode(t *testing.T) {
	t.Setenv("ARCHURA_ENV", "")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PLATFORM_ADMIN_KEY", "")
	t.Setenv("CORE_SERVICE_KEY", "")
	t.Setenv("REQUIRE_EDGE_AUTH", "")
	t.Setenv("CONFIRM_URL_BASE", "http://localhost:8787/confirm")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Env != "dev" || cfg.RequireEdgeAuth || cfg.ConfirmURLBase != "http://localhost:8787/confirm" {
		t.Fatalf("unexpected development defaults: %+v", cfg)
	}
}

func TestDevelopmentEdgeAuthRequiresServiceKey(t *testing.T) {
	t.Setenv("ARCHURA_ENV", "dev")
	t.Setenv("REQUIRE_EDGE_AUTH", "true")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("CORE_SERVICE_KEY", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "CORE_SERVICE_KEY") {
		t.Fatalf("Load error = %v, want missing CORE_SERVICE_KEY", err)
	}
}

func TestDevelopmentEdgeAuthRequiresDatabase(t *testing.T) {
	t.Setenv("ARCHURA_ENV", "dev")
	t.Setenv("REQUIRE_EDGE_AUTH", "true")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("CORE_SERVICE_KEY", "svc_test_0123456789012345678901234567890123456789012")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("Load error = %v, want missing DATABASE_URL", err)
	}
}

func TestProductionForcesEdgeAuthAndRequiredValues(t *testing.T) {
	t.Setenv("ARCHURA_ENV", "prod")
	t.Setenv("REQUIRE_EDGE_AUTH", "false")
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("PLATFORM_ADMIN_KEY", "adm_live_example")
	t.Setenv("CORE_SERVICE_KEY", "svc_live_0123456789012345678901234567890123456789012")
	t.Setenv("CONFIRM_URL_BASE", "https://archura.ai/confirm")
	t.Setenv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "account-id")
	t.Setenv("CLOUDFLARE_EMAIL_API_TOKEN", "email-token")
	t.Setenv("EMAIL_FROM", "hello@archura.ai")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.RequireEdgeAuth {
		t.Fatal("production must force edge authentication")
	}
}

func TestProductionRejectsMissingValuesAndMismatchedServiceKey(t *testing.T) {
	t.Setenv("ARCHURA_ENV", "prod")
	t.Setenv("DATABASE_URL", "")
	t.Setenv("PLATFORM_ADMIN_KEY", "")
	t.Setenv("CORE_SERVICE_KEY", "")
	t.Setenv("CONFIRM_URL_BASE", "")
	t.Setenv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "")
	t.Setenv("CLOUDFLARE_EMAIL_API_TOKEN", "")
	t.Setenv("EMAIL_FROM", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") || !strings.Contains(err.Error(), "PLATFORM_ADMIN_KEY") || !strings.Contains(err.Error(), "CORE_SERVICE_KEY") {
		t.Fatalf("Load error = %v, want all missing production variables", err)
	}

	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("PLATFORM_ADMIN_KEY", "adm_live_example")
	t.Setenv("CORE_SERVICE_KEY", "svc_test_0123456789012345678901234567890123456789012")
	t.Setenv("CONFIRM_URL_BASE", "https://archura.ai/confirm")
	t.Setenv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "account-id")
	t.Setenv("CLOUDFLARE_EMAIL_API_TOKEN", "email-token")
	t.Setenv("EMAIL_FROM", "hello@archura.ai")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("Load error = %v, want environment mismatch", err)
	}
}

func TestStripeBillingConfigurationIsAllOrNothing(t *testing.T) {
	t.Setenv("ARCHURA_ENV", "dev")
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_example")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "")
	t.Setenv("STRIPE_BASIC_PRICE_ID", "")
	t.Setenv("BILLING_PUBLIC_ORIGIN", "")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "requires") {
		t.Fatalf("Load error = %v, want complete billing group error", err)
	}

	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_example")
	t.Setenv("STRIPE_BASIC_PRICE_ID", "price_example")
	t.Setenv("BILLING_PUBLIC_ORIGIN", "http://localhost:8787")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.StripeBasicPriceID != "price_example" {
		t.Fatalf("StripeBasicPriceID = %q", cfg.StripeBasicPriceID)
	}

	t.Setenv("BILLING_PUBLIC_ORIGIN", "http://localhost:8787/not-an-origin")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "origin") {
		t.Fatalf("Load error = %v, want origin validation", err)
	}
}
