package api

import (
	"net/http"
	"strconv"
	"time"
)

const (
	clientCreateLimit           = 10
	componentWriteLimit         = 30
	componentSessionCreateLimit = 60
)

type rateLimitRequest struct {
	subject   string
	operation string
	limit     int
	window    time.Duration
}

func (s *Server) enforceRateLimit(w http.ResponseWriter, r *http.Request, subject, operation string, limit int, window time.Duration) bool {
	return s.enforceRateLimits(w, r, []rateLimitRequest{{
		subject: subject, operation: operation, limit: limit, window: window,
	}})
}

func (s *Server) enforceRateLimits(w http.ResponseWriter, r *http.Request, requests []rateLimitRequest) bool {
	// Rate limiting is a production protection. Development stays frictionless,
	// including when it enables edge authentication for local Worker testing.
	if s.cfg.Env != "prod" {
		return true
	}
	retryAfter := 0
	for _, request := range requests {
		result, err := s.store.ConsumeRateLimit(r.Context(), request.subject, request.operation, request.limit, request.window)
		if err != nil {
			s.internalError(w, r, err)
			return false
		}
		if !result.Allowed && result.RetryAfterSeconds > retryAfter {
			retryAfter = result.RetryAfterSeconds
		}
	}
	if retryAfter == 0 {
		return true
	}
	w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
	s.metrics.IncRateLimitRejection()
	s.securityEvent(r, "rate_limit_rejected")
	writeError(w, r, http.StatusTooManyRequests, "rate_limited", "Too many requests.")
	return false
}
