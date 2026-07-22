package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	archauth "github.com/archura/core/internal/auth"
)

// Config is the typed 12-factor configuration for the core server.
type Config struct {
	Env                 string // "dev" | "staging" | "prod"
	Port                string
	MetricsPort         string
	DatabaseURL         string // empty in local scaffold runs => DB features disabled
	PlatformAdminKey    string // gates platform-admin endpoints (client onboarding)
	CoreServiceKey      string // authenticates the Cloudflare Worker to the core (transport)
	CoreInternalKey     string // per-request auth for machine-invoked endpoints (Worker cron/serving)
	ConfirmURLBase      string // Public Worker confirmation URL; required in hosted environments and for local email links
	EmailAccountID      string // Cloudflare account used by Email Service outside development
	EmailAPIToken       string // Cloudflare Email Service API token
	EmailFrom           string // verified sender address
	StripeSecretKey     string // Stripe test/live secret, stored only in the core environment
	StripeWebhookSecret string // signing secret for the public Stripe webhook endpoint
	StripeBasicPriceID  string // recurring $5 Basic price
	BillingPublicOrigin string // Worker origin used for Checkout and portal returns
	RequireEdgeAuth     bool   // optional in dev; always true in staging and prod
	AdminAPIEnabled     bool   // defaults on only in dev
}

func Load() (Config, error) {
	env := getenv("ARCHURA_ENV", "dev")
	requireEdgeAuth, err := optionalBool("REQUIRE_EDGE_AUTH")
	if err != nil {
		return Config{}, err
	}
	adminAPIEnabled := env == "dev"
	if os.Getenv("ADMIN_API_ENABLED") != "" {
		adminAPIEnabled, err = optionalBool("ADMIN_API_ENABLED")
		if err != nil {
			return Config{}, err
		}
	}
	cfg := Config{
		Env:                 env,
		Port:                getenv("PORT", "8080"),
		MetricsPort:         getenv("METRICS_PORT", "9091"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		PlatformAdminKey:    os.Getenv("PLATFORM_ADMIN_KEY"),
		CoreServiceKey:      os.Getenv("CORE_SERVICE_KEY"),
		CoreInternalKey:     os.Getenv("CORE_INTERNAL_KEY"),
		ConfirmURLBase:      os.Getenv("CONFIRM_URL_BASE"),
		EmailAccountID:      os.Getenv("CLOUDFLARE_EMAIL_ACCOUNT_ID"),
		EmailAPIToken:       os.Getenv("CLOUDFLARE_EMAIL_API_TOKEN"),
		EmailFrom:           os.Getenv("EMAIL_FROM"),
		StripeSecretKey:     os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret: os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripeBasicPriceID:  os.Getenv("STRIPE_BASIC_PRICE_ID"),
		BillingPublicOrigin: os.Getenv("BILLING_PUBLIC_ORIGIN"),
		RequireEdgeAuth:     requireEdgeAuth,
		AdminAPIEnabled:     adminAPIEnabled,
	}
	if isHostedEnvironment(cfg.Env) {
		cfg.RequireEdgeAuth = true
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	if c.Env != "dev" && c.Env != "staging" && c.Env != "prod" {
		return fmt.Errorf("ARCHURA_ENV must be dev, staging, or prod")
	}
	if isHostedEnvironment(c.Env) {
		missing := make([]string, 0, 7)
		if c.DatabaseURL == "" {
			missing = append(missing, "DATABASE_URL")
		}
		if c.PlatformAdminKey == "" {
			missing = append(missing, "PLATFORM_ADMIN_KEY")
		}
		if c.CoreServiceKey == "" {
			missing = append(missing, "CORE_SERVICE_KEY")
		}
		if c.CoreInternalKey == "" {
			missing = append(missing, "CORE_INTERNAL_KEY")
		}
		if c.ConfirmURLBase == "" {
			missing = append(missing, "CONFIRM_URL_BASE")
		}
		if c.EmailAccountID == "" {
			missing = append(missing, "CLOUDFLARE_EMAIL_ACCOUNT_ID")
		}
		if c.EmailAPIToken == "" {
			missing = append(missing, "CLOUDFLARE_EMAIL_API_TOKEN")
		}
		if c.EmailFrom == "" {
			missing = append(missing, "EMAIL_FROM")
		}
		if len(missing) > 0 {
			return fmt.Errorf("%s configuration missing %s", c.Env, strings.Join(missing, ", "))
		}
	}
	if c.RequireEdgeAuth && c.DatabaseURL == "" {
		return errors.New("REQUIRE_EDGE_AUTH requires DATABASE_URL")
	}
	if c.RequireEdgeAuth && c.CoreServiceKey == "" {
		return errors.New("REQUIRE_EDGE_AUTH requires CORE_SERVICE_KEY")
	}
	if c.PlatformAdminKey != "" && !archauth.HasKindForEnv(c.PlatformAdminKey, "adm", c.Env) {
		return errors.New("PLATFORM_ADMIN_KEY does not match ARCHURA_ENV")
	}
	if c.CoreServiceKey != "" && !archauth.HasKindForEnv(c.CoreServiceKey, "svc", c.Env) {
		return errors.New("CORE_SERVICE_KEY does not match ARCHURA_ENV")
	}
	if c.CoreInternalKey != "" && !archauth.HasKindForEnv(c.CoreInternalKey, "int", c.Env) {
		return errors.New("CORE_INTERNAL_KEY does not match ARCHURA_ENV")
	}
	billingValues := []string{c.StripeSecretKey, c.StripeWebhookSecret, c.StripeBasicPriceID, c.BillingPublicOrigin}
	billingSet := 0
	for _, value := range billingValues {
		if value != "" {
			billingSet++
		}
	}
	if billingSet != 0 && billingSet != len(billingValues) {
		return errors.New("Stripe billing requires STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_BASIC_PRICE_ID, and BILLING_PUBLIC_ORIGIN together")
	}
	if billingSet == len(billingValues) {
		usesTestKey := strings.HasPrefix(c.StripeSecretKey, "sk_test_")
		usesLiveKey := strings.HasPrefix(c.StripeSecretKey, "sk_live_")
		if !usesTestKey && !usesLiveKey {
			return errors.New("STRIPE_SECRET_KEY is invalid")
		}
		if c.Env != "prod" && !usesTestKey {
			return errors.New("STRIPE_SECRET_KEY must use test mode outside production")
		}
		if !strings.HasPrefix(c.StripeWebhookSecret, "whsec_") {
			return errors.New("STRIPE_WEBHOOK_SECRET is invalid")
		}
		if !strings.HasPrefix(c.StripeBasicPriceID, "price_") {
			return errors.New("STRIPE_BASIC_PRICE_ID is invalid")
		}
		billingOrigin, err := url.Parse(c.BillingPublicOrigin)
		if err != nil || (billingOrigin.Scheme != "http" && billingOrigin.Scheme != "https") ||
			billingOrigin.Host == "" || (billingOrigin.Path != "" && billingOrigin.Path != "/") ||
			billingOrigin.RawQuery != "" || billingOrigin.Fragment != "" || billingOrigin.User != nil {
			return errors.New("BILLING_PUBLIC_ORIGIN must be an HTTP(S) origin")
		}
		if isHostedEnvironment(c.Env) && !strings.HasPrefix(c.BillingPublicOrigin, "https://") {
			return errors.New("BILLING_PUBLIC_ORIGIN must use HTTPS in staging and production")
		}
	}
	return nil
}

func isHostedEnvironment(env string) bool {
	return env == "staging" || env == "prod"
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func optionalBool(key string) (bool, error) {
	value := os.Getenv(key)
	if value == "" {
		return false, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("%s must be true or false", key)
	}
	return parsed, nil
}
