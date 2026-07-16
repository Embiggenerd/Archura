package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/archura/core/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	st, err := store.Open(ctx, databaseURL)
	if err != nil {
		log.Error("database connect failed", "err", err)
		os.Exit(1)
	}
	defer st.Close()
	result, err := st.RunMaintenance(ctx)
	if err != nil {
		log.Error("maintenance failed", "err", err)
		os.Exit(1)
	}
	log.Info("maintenance complete",
		"component_sessions_deleted", result.ComponentSessions,
		"rate_limit_buckets_deleted", result.RateLimitBuckets)
}
