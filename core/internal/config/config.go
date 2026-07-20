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
	Env                 string // "dev" | "prod"
	Port                string
	MetricsPort         string
	DatabaseURL         string // empty in local scaffold runs => DB features disabled
	PlatformAdminKey    string // gates platform-admin endpoints (client onboarding)
	CoreServiceKey      string // authenticates the Cloudflare Worker to the core
	ConfirmURLBase      string // Public Worker confirmation URL; required in production and for local email links
	EmailAccountID      string // Cloudflare account used by Email Service in production
	EmailAPIToken       string // Cloudflare Email Service API token
	EmailFrom           string // verified sender address
	StripeSecretKey     string // Stripe test/live secret, stored only in the core environment
	StripeWebhookSecret string // signing secret for the public Stripe webhook endpoint
	StripeBasicPriceID  string // recurring $5 Basic price
	BillingPublicOrigin string // Worker origin used for Checkout and portal returns
	RequireEdgeAuth     bool   // optional in dev; always true in prod
}

func Load() (Config, error) {
	requireEdgeAuth, err := optionalBool("REQUIRE_EDGE_AUTH")
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Env:                 getenv("ARCHURA_ENV", "dev"),
		Port:                getenv("PORT", "8080"),
		MetricsPort:         getenv("METRICS_PORT", "9091"),
		DatabaseURL:         os.Getenv("DATABASE_URL"),
		PlatformAdminKey:    os.Getenv("PLATFORM_ADMIN_KEY"),
		CoreServiceKey:      os.Getenv("CORE_SERVICE_KEY"),
		ConfirmURLBase:      os.Getenv("CONFIRM_URL_BASE"),
		EmailAccountID:      os.Getenv("CLOUDFLARE_EMAIL_ACCOUNT_ID"),
		EmailAPIToken:       os.Getenv("CLOUDFLARE_EMAIL_API_TOKEN"),
		EmailFrom:           os.Getenv("EMAIL_FROM"),
		StripeSecretKey:     os.Getenv("STRIPE_SECRET_KEY"),
		StripeWebhookSecret: os.Getenv("STRIPE_WEBHOOK_SECRET"),
		StripeBasicPriceID:  os.Getenv("STRIPE_BASIC_PRICE_ID"),
		BillingPublicOrigin: os.Getenv("BILLING_PUBLIC_ORIGIN"),
		RequireEdgeAuth:     requireEdgeAuth,
	}
	if cfg.Env == "prod" {
		cfg.RequireEdgeAuth = true
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	if c.Env != "dev" && c.Env != "prod" {
		return fmt.Errorf("ARCHURA_ENV must be dev or prod")
	}
	if c.Env == "prod" {
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
			return fmt.Errorf("production configuration missing %s", strings.Join(missing, ", "))
		}
	}
	if c.RequireEdgeAuth && c.DatabaseURL == "" {
		return errors.New("REQUIRE_EDGE_AUTH requires DATABASE_URL")
	}
	if c.RequireEdgeAuth && c.CoreServiceKey == "" {
		return errors.New("REQUIRE_EDGE_AUTH requires CORE_SERVICE_KEY")
	}
	if c.CoreServiceKey != "" && !archauth.HasKindForEnv(c.CoreServiceKey, "svc", c.Env) {
		return errors.New("CORE_SERVICE_KEY does not match ARCHURA_ENV")
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
		if !strings.HasPrefix(c.StripeSecretKey, "sk_test_") && !strings.HasPrefix(c.StripeSecretKey, "sk_live_") {
			return errors.New("STRIPE_SECRET_KEY is invalid")
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
		if c.Env == "prod" && !strings.HasPrefix(c.BillingPublicOrigin, "https://") {
			return errors.New("BILLING_PUBLIC_ORIGIN must use HTTPS in production")
		}
	}
	return nil
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
