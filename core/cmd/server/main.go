package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/archura/core/internal/api"
	"github.com/archura/core/internal/buildinfo"
	"github.com/archura/core/internal/config"
	"github.com/archura/core/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	ctx := context.Background()

	// DB is optional at boot so the scaffold runs with no infra; in prod
	// DATABASE_URL is set and migrations run before serving.
	var st *store.Store
	if cfg.DatabaseURL != "" {
		opened, err := store.Open(ctx, cfg.DatabaseURL)
		if err != nil {
			log.Error("database connect failed", "err", err)
			os.Exit(1)
		}
		if err := opened.Migrate(ctx); err != nil {
			log.Error("migrations failed", "err", err)
			os.Exit(1)
		}
		st = opened
		defer st.Close()
		log.Info("database connected and migrated")
	} else {
		log.Warn("no DATABASE_URL set; running without database (scaffold mode)")
	}

	apiServer := api.NewServer(cfg, st, log)
	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           apiServer.Router(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	metricsSrv := &http.Server{
		Addr:              ":" + cfg.MetricsPort,
		Handler:           apiServer.MetricsHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Info("core server listening", "port", cfg.Port, "metrics_port", cfg.MetricsPort,
			"env", cfg.Env, "version", buildinfo.Version, "commit", buildinfo.Commit, "build_time", buildinfo.BuildTime)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server error", "err", err)
			os.Exit(1)
		}
	}()
	go func() {
		if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("metrics server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("graceful shutdown failed", "err", err)
	}
	if err := metricsSrv.Shutdown(shutdownCtx); err != nil {
		log.Error("metrics shutdown failed", "err", err)
	}
	log.Info("core server stopped")
}
