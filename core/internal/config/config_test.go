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
	t.Setenv("ADMIN_API_ENABLED", "")
	t.Setenv("CONFIRM_URL_BASE", "http://localhost:8787/confirm")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Env != "dev" || cfg.RequireEdgeAuth || !cfg.AdminAPIEnabled || cfg.ConfirmURLBase != "http://localhost:8787/confirm" {
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
	t.Setenv("CORE_INTERNAL_KEY", "int_live_0123456789012345678901234567890123456789012")
	t.Setenv("CONFIRM_URL_BASE", "https://archura.ai/confirm")
	t.Setenv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "account-id")
	t.Setenv("CLOUDFLARE_EMAIL_API_TOKEN", "email-token")
	t.Setenv("EMAIL_FROM", "hello@archura.ai")
	t.Setenv("ADMIN_API_ENABLED", "")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.RequireEdgeAuth {
		t.Fatal("production must force edge authentication")
	}
	if cfg.AdminAPIEnabled {
		t.Fatal("production must default the admin API off")
	}
}

func TestStagingForcesHostedRequirements(t *testing.T) {
	setValidConfigEnvironment(t, "staging")
	t.Setenv("REQUIRE_EDGE_AUTH", "false")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Env != "staging" || !cfg.RequireEdgeAuth || cfg.AdminAPIEnabled {
		t.Fatalf("unexpected staging configuration: %+v", cfg)
	}

	t.Setenv("DATABASE_URL", "")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "staging configuration missing DATABASE_URL") {
		t.Fatalf("Load error = %v, want missing staging database", err)
	}
}

func TestAdminAPIDefaultAndOverrideByEnvironment(t *testing.T) {
	for _, test := range []struct {
		env         string
		wantDefault bool
	}{
		{env: "dev", wantDefault: true},
		{env: "staging", wantDefault: false},
		{env: "prod", wantDefault: false},
	} {
		t.Run(test.env, func(t *testing.T) {
			setValidConfigEnvironment(t, test.env)
			cfg, err := Load()
			if err != nil {
				t.Fatal(err)
			}
			if cfg.AdminAPIEnabled != test.wantDefault {
				t.Fatalf("default AdminAPIEnabled = %v, want %v", cfg.AdminAPIEnabled, test.wantDefault)
			}
			if test.wantDefault {
				t.Setenv("ADMIN_API_ENABLED", "false")
			} else {
				t.Setenv("ADMIN_API_ENABLED", "true")
			}
			cfg, err = Load()
			if err != nil {
				t.Fatal(err)
			}
			if cfg.AdminAPIEnabled == test.wantDefault {
				t.Fatalf("ADMIN_API_ENABLED did not override the %s default", test.env)
			}
		})
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
	if err == nil || !strings.Contains(err.Error(), "DATABASE_URL") || !strings.Contains(err.Error(), "PLATFORM_ADMIN_KEY") || !strings.Contains(err.Error(), "CORE_SERVICE_KEY") || !strings.Contains(err.Error(), "CORE_INTERNAL_KEY") {
		t.Fatalf("Load error = %v, want all missing production variables", err)
	}

	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("PLATFORM_ADMIN_KEY", "adm_live_example")
	t.Setenv("CORE_SERVICE_KEY", "svc_test_0123456789012345678901234567890123456789012")
	t.Setenv("CORE_INTERNAL_KEY", "int_live_0123456789012345678901234567890123456789012")
	t.Setenv("CONFIRM_URL_BASE", "https://archura.ai/confirm")
	t.Setenv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "account-id")
	t.Setenv("CLOUDFLARE_EMAIL_API_TOKEN", "email-token")
	t.Setenv("EMAIL_FROM", "hello@archura.ai")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("Load error = %v, want environment mismatch", err)
	}

	t.Setenv("CORE_SERVICE_KEY", "svc_live_0123456789012345678901234567890123456789012")
	t.Setenv("CORE_INTERNAL_KEY", "int_test_0123456789012345678901234567890123456789012")
	_, err = Load()
	if err == nil || !strings.Contains(err.Error(), "CORE_INTERNAL_KEY does not match") {
		t.Fatalf("Load error = %v, want internal key environment mismatch", err)
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

func TestCredentialNamespacesMatchEnvironment(t *testing.T) {
	for _, test := range []struct {
		name     string
		env      string
		adminKey string
	}{
		{name: "dev rejects live", env: "dev", adminKey: "adm_live_example"},
		{name: "staging rejects live", env: "staging", adminKey: "adm_live_example"},
		{name: "prod rejects test", env: "prod", adminKey: "adm_test_example"},
	} {
		t.Run(test.name, func(t *testing.T) {
			setValidConfigEnvironment(t, test.env)
			t.Setenv("PLATFORM_ADMIN_KEY", test.adminKey)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), "PLATFORM_ADMIN_KEY does not match ARCHURA_ENV") {
				t.Fatalf("Load error = %v, want admin-key environment mismatch", err)
			}
		})
	}
}

func TestStripeKeyModeMatchesEnvironment(t *testing.T) {
	for _, test := range []struct {
		name      string
		env       string
		secretKey string
		wantError bool
	}{
		{name: "dev test", env: "dev", secretKey: "sk_test_example"},
		{name: "dev live", env: "dev", secretKey: "sk_live_example", wantError: true},
		{name: "staging test", env: "staging", secretKey: "sk_test_example"},
		{name: "staging live", env: "staging", secretKey: "sk_live_example", wantError: true},
		{name: "prod test transition", env: "prod", secretKey: "sk_test_example"},
		{name: "prod live", env: "prod", secretKey: "sk_live_example"},
	} {
		t.Run(test.name, func(t *testing.T) {
			setValidConfigEnvironment(t, test.env)
			t.Setenv("STRIPE_SECRET_KEY", test.secretKey)
			t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_example")
			t.Setenv("STRIPE_BASIC_PRICE_ID", "price_example")
			t.Setenv("BILLING_PUBLIC_ORIGIN", "https://archura.ai")
			_, err := Load()
			if test.wantError {
				if err == nil || !strings.Contains(err.Error(), "test mode outside production") {
					t.Fatalf("Load error = %v, want Stripe environment mismatch", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStagingBillingOriginRequiresHTTPS(t *testing.T) {
	setValidConfigEnvironment(t, "staging")
	t.Setenv("STRIPE_SECRET_KEY", "sk_test_example")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "whsec_example")
	t.Setenv("STRIPE_BASIC_PRICE_ID", "price_example")
	t.Setenv("BILLING_PUBLIC_ORIGIN", "http://staging.archura.ai")

	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("Load error = %v, want staging HTTPS requirement", err)
	}
}

func setValidConfigEnvironment(t *testing.T, env string) {
	t.Helper()
	t.Setenv("ARCHURA_ENV", env)
	t.Setenv("REQUIRE_EDGE_AUTH", "false")
	t.Setenv("ADMIN_API_ENABLED", "")
	t.Setenv("STRIPE_SECRET_KEY", "")
	t.Setenv("STRIPE_WEBHOOK_SECRET", "")
	t.Setenv("STRIPE_BASIC_PRICE_ID", "")
	t.Setenv("BILLING_PUBLIC_ORIGIN", "")
	if env == "dev" {
		t.Setenv("DATABASE_URL", "")
		t.Setenv("PLATFORM_ADMIN_KEY", "adm_test_example")
		t.Setenv("CORE_SERVICE_KEY", "")
		t.Setenv("CORE_INTERNAL_KEY", "")
		t.Setenv("CONFIRM_URL_BASE", "http://localhost:8787/confirm")
		t.Setenv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "")
		t.Setenv("CLOUDFLARE_EMAIL_API_TOKEN", "")
		t.Setenv("EMAIL_FROM", "")
		return
	}
	mode := "test"
	if env == "prod" {
		mode = "live"
	}
	t.Setenv("DATABASE_URL", "postgres://example")
	t.Setenv("PLATFORM_ADMIN_KEY", "adm_"+mode+"_example")
	t.Setenv("CORE_SERVICE_KEY", "svc_"+mode+"_example")
	t.Setenv("CORE_INTERNAL_KEY", "int_"+mode+"_example")
	t.Setenv("CONFIRM_URL_BASE", "https://archura.ai/confirm")
	t.Setenv("CLOUDFLARE_EMAIL_ACCOUNT_ID", "account-id")
	t.Setenv("CLOUDFLARE_EMAIL_API_TOKEN", "email-token")
	t.Setenv("EMAIL_FROM", "hello@archura.ai")
}
