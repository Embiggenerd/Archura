package telemetry

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPrometheusMetricsUseBoundedLabels(t *testing.T) {
	metrics := New(func() DBStats { return DBStats{Acquired: 2, Idle: 3, Max: 10} })
	metrics.ObserveRequest(http.MethodPost, "/v1/components/{componentID}", http.StatusForbidden, 25*time.Millisecond)
	metrics.IncAuthFailure("component_origin_rejected")
	metrics.IncSessionCreated()
	metrics.IncRateLimitRejection()

	recorder := httptest.NewRecorder()
	metrics.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := recorder.Body.String()
	for _, expected := range []string{
		`archura_http_requests_total{method="POST",route="/v1/components/{componentID}",status_class="4xx"} 1`,
		`archura_auth_failures_total{reason="component_origin_rejected"} 1`,
		`archura_component_sessions_created_total 1`,
		`archura_rate_limit_rejections_total 1`,
		`archura_db_pool_acquired_connections 2`,
		`archura_db_pool_idle_connections 3`,
		`archura_db_pool_max_connections 10`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("metrics missing %q:\n%s", expected, body)
		}
	}
	for _, forbidden := range []string{"tenant_id", "component_id", "request_id"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("metrics contain high-cardinality label %q:\n%s", forbidden, body)
		}
	}
}
