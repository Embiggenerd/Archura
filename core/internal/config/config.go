package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	archauth "github.com/archura/core/internal/auth"
)

// Config is the typed 12-factor configuration for the core server.
type Config struct {
	Env              string // "dev" | "prod"
	Port             string
	MetricsPort      string
	DatabaseURL      string // empty in local scaffold runs => DB features disabled
	PlatformAdminKey string // gates platform-admin endpoints (client onboarding)
	CoreServiceKey   string // authenticates the Cloudflare Worker to the core
	ConfirmURLBase   string // Worker confirmation URL; required by confirmation creation in dev
	RequireEdgeAuth  bool   // optional in dev; always true in prod
}

func Load() (Config, error) {
	requireEdgeAuth, err := optionalBool("REQUIRE_EDGE_AUTH")
	if err != nil {
		return Config{}, err
	}
	cfg := Config{
		Env:              getenv("ARCHURA_ENV", "dev"),
		Port:             getenv("PORT", "8080"),
		MetricsPort:      getenv("METRICS_PORT", "9091"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		PlatformAdminKey: os.Getenv("PLATFORM_ADMIN_KEY"),
		CoreServiceKey:   os.Getenv("CORE_SERVICE_KEY"),
		ConfirmURLBase:   os.Getenv("CONFIRM_URL_BASE"),
		RequireEdgeAuth:  requireEdgeAuth,
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
		missing := make([]string, 0, 3)
		if c.DatabaseURL == "" {
			missing = append(missing, "DATABASE_URL")
		}
		if c.PlatformAdminKey == "" {
			missing = append(missing, "PLATFORM_ADMIN_KEY")
		}
		if c.CoreServiceKey == "" {
			missing = append(missing, "CORE_SERVICE_KEY")
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
