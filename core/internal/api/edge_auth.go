package api

import (
	"net/http"
	"strings"

	archauth "github.com/archura/core/internal/auth"
)

const serviceAuthorizationHeader = "X-Archura-Service-Authorization"

func (s *Server) requireEdgeAuthentication(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.cfg.RequireEdgeAuth {
			next.ServeHTTP(w, r)
			return
		}

		token, ok := headerBearerToken(r.Header.Get(serviceAuthorizationHeader))
		kindMatches := archauth.HasKindForEnv(token, "svc", s.cfg.Env)
		keyMatches := archauth.Equal(token, s.cfg.CoreServiceKey)
		if !ok || !kindMatches || !keyMatches {
			s.securityEvent(r, "invalid_service_key")
			writeError(w, r, http.StatusUnauthorized, "invalid_service_key", "The service credential is invalid.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func headerBearerToken(value string) (string, bool) {
	parts := strings.SplitN(value, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return "", false
	}
	token := strings.TrimSpace(parts[1])
	return token, token != ""
}
