package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if len(os.Args) < 2 {
		usage()
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	env := os.Getenv("ARCHURA_ENV")
	if env == "" {
		env = "dev"
	}
	if env != "dev" && env != "prod" {
		log.Error("ARCHURA_ENV must be dev or prod")
		os.Exit(1)
	}
	// The platform owner is configured in .env, not passed on the command line.
	ownerEmail := os.Getenv("PLATFORM_OWNER_EMAIL")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	st, err := store.Open(ctx, databaseURL)
	if err != nil {
		log.Error("database connect failed", "err", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		log.Error("migrations failed", "err", err)
		os.Exit(1)
	}

	publishableKey, err := archauth.Generate("pk", env)
	if err != nil {
		log.Error("workspace key generation failed", "err", err)
		os.Exit(1)
	}
	secretKey, err := archauth.Generate("sk", env)
	if err != nil {
		log.Error("workspace key generation failed", "err", err)
		os.Exit(1)
	}
	requestID := fmt.Sprintf("adminctl-%d", time.Now().UTC().UnixNano())
	workspace, err := st.BootstrapPlatformWorkspace(ctx, store.CreateOrganizationParams{
		PublishableKey: publishableKey,
		SecretKeyHash:  archauth.Hash(secretKey),
	}, store.AuditEvent{
		ActorType: "internal", ActorID: "admin_cli", RequestID: requestID,
	})
	if err != nil {
		log.Error("workspace bootstrap failed", "err", err)
		os.Exit(1)
	}

	audit := store.AuditEvent{ActorType: "internal", ActorID: "admin_cli", RequestID: requestID}

	switch os.Args[1] {
	case "bootstrap":
		if len(os.Args) != 2 {
			usage()
		}
		log.Info("platform workspace ready", "organization_id", workspace.ID, "slug", workspace.Slug)
		// Bootstrap also grants PLATFORM_OWNER_EMAIL when that account exists.
		if ownerEmail != "" {
			account, grantErr := st.GrantStaff(ctx, ownerEmail, audit)
			switch {
			case errors.Is(grantErr, store.ErrNotFound):
				log.Warn("platform owner account not found yet; sign up as this email, then re-run", "email", ownerEmail)
			case grantErr != nil:
				log.Error("grant platform owner failed", "email", ownerEmail, "err", grantErr)
				os.Exit(1)
			default:
				log.Info("platform owner granted from PLATFORM_OWNER_EMAIL", "email", account.Email, "account_id", account.ID)
			}
		}
	case "grant-staff", "revoke-staff":
		target := ownerEmail
		switch len(os.Args) {
		case 3:
			target = os.Args[2]
		case 2:
			// no argument: fall back to PLATFORM_OWNER_EMAIL
		default:
			usage()
		}
		if target == "" {
			log.Error("provide an account id/email argument or set PLATFORM_OWNER_EMAIL")
			os.Exit(1)
		}
		var account store.Account
		if os.Args[1] == "grant-staff" {
			account, err = st.GrantStaff(ctx, target, audit)
		} else {
			account, err = st.RevokeStaff(ctx, target, audit)
		}
		if err != nil {
			log.Error("staff update failed", "command", os.Args[1], "account", target, "err", err)
			os.Exit(1)
		}
		log.Info("staff role updated", "command", os.Args[1], "account_id", account.ID,
			"email", account.Email, "staff_role", account.StaffRole)
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: adminctl bootstrap | grant-staff [account] | revoke-staff [account]")
	fmt.Fprintln(os.Stderr, "  account defaults to PLATFORM_OWNER_EMAIL when omitted")
	os.Exit(2)
}
