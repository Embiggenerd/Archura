package api

import (
	"net/http"
	"strconv"
)

const (
	clientCreateLimit           = 10
	componentWriteLimit         = 30
	componentSessionCreateLimit = 60
)

func (s *Server) enforceRateLimit(w http.ResponseWriter, r *http.Request, subject, operation string, limit int) bool {
	// Direct local development remains frictionless. Production and local edge
	// simulation both set RequireEdgeAuth and exercise the shared DB limiter.
	if !s.cfg.RequireEdgeAuth {
		return true
	}
	result, err := s.store.ConsumeRateLimit(r.Context(), subject, operation, limit)
	if err != nil {
		s.internalError(w, r, err)
		return false
	}
	if result.Allowed {
		return true
	}
	w.Header().Set("Retry-After", strconv.Itoa(result.RetryAfterSeconds))
	s.metrics.IncRateLimitRejection()
	s.securityEvent(r, "rate_limit_rejected")
	writeError(w, r, http.StatusTooManyRequests, "rate_limited", "Too many requests.")
	return false
}
