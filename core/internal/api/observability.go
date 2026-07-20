package api

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

const (
	trustedClientIPHeader = "X-Archura-Client-IP"
	securitySampleWindow  = time.Minute
	securitySampleMaxKeys = 10_000
)

type requestMetadataKey struct{}

type requestMetadata struct {
	OrganizationID string
	ComponentID    string
	ClientIP       string
}

func metadataFromRequest(r *http.Request) *requestMetadata {
	metadata, _ := r.Context().Value(requestMetadataKey{}).(*requestMetadata)
	return metadata
}

func (s *Server) initializeRequestMetadata(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		metadata := &requestMetadata{ClientIP: socketIP(r.RemoteAddr)}
		ctx := context.WithValue(r.Context(), requestMetadataKey{}, metadata)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Server) trustedClientIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.RequireEdgeAuth {
			if candidate := r.Header.Get(trustedClientIPHeader); net.ParseIP(candidate) != nil {
				if metadata := metadataFromRequest(r); metadata != nil {
					metadata.ClientIP = candidate
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) accessLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(wrapped, r)

		status := wrapped.Status()
		if status == 0 {
			status = http.StatusOK
		}
		route := "unmatched"
		if routeContext := chi.RouteContext(r.Context()); routeContext != nil && routeContext.RoutePattern() != "" {
			route = routeContext.RoutePattern()
		}
		duration := time.Since(started)
		s.metrics.ObserveRequest(r.Method, route, status, duration)
		if status < http.StatusBadRequest && (route == "/healthz" || route == "/readyz") {
			return
		}
		attrs := []slog.Attr{
			slog.String("event", "http_request"),
			slog.String("request_id", middleware.GetReqID(r.Context())),
			slog.String("method", r.Method),
			slog.String("route", route),
			slog.Int("status", status),
			slog.Int("response_bytes", wrapped.BytesWritten()),
			slog.Int64("duration_ms", duration.Milliseconds()),
		}
		if metadata := metadataFromRequest(r); metadata != nil {
			attrs = append(attrs, slog.String("client_ip", metadata.ClientIP))
			if metadata.OrganizationID != "" {
				attrs = append(attrs, slog.String("organization_id", metadata.OrganizationID))
			}
			if metadata.ComponentID != "" {
				attrs = append(attrs, slog.String("component_id", metadata.ComponentID))
			}
		}
		s.log.LogAttrs(r.Context(), slog.LevelInfo, "request completed", attrs...)
	})
}

func (s *Server) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.log.ErrorContext(r.Context(), "request panic",
					"event", "request_panic",
					"request_id", middleware.GetReqID(r.Context()),
					"panic_type", fmt.Sprintf("%T", recovered),
					"stack", string(debug.Stack()),
				)
				writeError(w, r, http.StatusInternalServerError, "internal_error", "The request could not be completed.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type securitySampleEntry struct {
	lastLogged time.Time
	suppressed int
}

type securityLogSampler struct {
	mu      sync.Mutex
	entries map[string]securitySampleEntry
	order   []securitySampleOrder
	head    int
	now     func() time.Time
	window  time.Duration
	maxKeys int
}

type securitySampleOrder struct {
	key        string
	lastLogged time.Time
}

func newSecurityLogSampler() *securityLogSampler {
	return &securityLogSampler{
		entries: make(map[string]securitySampleEntry),
		now:     time.Now, window: securitySampleWindow, maxKeys: securitySampleMaxKeys,
	}
}

func (s *securityLogSampler) allow(key string) (bool, int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now()
	entry, exists := s.entries[key]
	if !exists {
		if len(s.entries) >= s.maxKeys {
			s.evictOldest()
		}
		s.entries[key] = securitySampleEntry{lastLogged: now}
		s.order = append(s.order, securitySampleOrder{key: key, lastLogged: now})
		return true, 0
	}
	if now.Sub(entry.lastLogged) < s.window {
		entry.suppressed++
		s.entries[key] = entry
		return false, 0
	}

	suppressed := entry.suppressed
	s.entries[key] = securitySampleEntry{lastLogged: now}
	s.order = append(s.order, securitySampleOrder{key: key, lastLogged: now})
	return true, suppressed
}

func (s *securityLogSampler) evictOldest() {
	for s.head < len(s.order) {
		candidate := s.order[s.head]
		s.head++
		entry, exists := s.entries[candidate.key]
		if exists && entry.lastLogged.Equal(candidate.lastLogged) {
			delete(s.entries, candidate.key)
			break
		}
	}
	if s.head >= s.maxKeys && s.head*2 >= len(s.order) {
		s.order = append([]securitySampleOrder(nil), s.order[s.head:]...)
		s.head = 0
	}
}

func (s *Server) securityEvent(r *http.Request, reason string, attrs ...slog.Attr) {
	if reason != "rate_limit_rejected" {
		s.metrics.IncAuthFailure(reason)
	}
	clientIP := socketIP(r.RemoteAddr)
	if metadata := metadataFromRequest(r); metadata != nil && metadata.ClientIP != "" {
		clientIP = metadata.ClientIP
	}
	allowed, suppressed := s.securitySampler.allow(clientIP + "|" + reason)
	if !allowed {
		return
	}
	base := []slog.Attr{
		slog.String("event", "security_event"),
		slog.String("reason", reason),
		slog.String("request_id", middleware.GetReqID(r.Context())),
		slog.String("client_ip", clientIP),
	}
	if suppressed > 0 {
		base = append(base, slog.Int("suppressed_count", suppressed))
	}
	base = append(base, attrs...)
	s.log.LogAttrs(r.Context(), slog.LevelWarn, "request rejected", base...)
}

func socketIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err == nil {
		return host
	}
	return remoteAddr
}
