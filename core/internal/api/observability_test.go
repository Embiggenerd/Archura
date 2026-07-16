package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/archura/core/internal/config"
)

func TestStructuredAccessAndPanicLogsShareRequestID(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	server := NewServer(config.Config{Env: "dev"}, nil, logger)

	panicHandler := http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("sensitive panic value")
	})
	handler := middleware.RequestID(server.initializeRequestMetadata(server.accessLogger(server.recoverer(panicHandler))))
	request := httptest.NewRequest(http.MethodGet, "/panic/123", nil)
	request.RemoteAddr = "192.0.2.10:4321"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("panic status = %d, want 500", recorder.Code)
	}
	records := decodeLogRecords(t, logs.String())
	if len(records) != 2 {
		t.Fatalf("log records = %d, want panic + access logs; logs=%s", len(records), logs.String())
	}
	panicLog := recordWithEvent(t, records, "request_panic")
	accessLog := recordWithEvent(t, records, "http_request")
	if panicLog["request_id"] == "" || panicLog["request_id"] != accessLog["request_id"] {
		t.Fatalf("request IDs differ: panic=%v access=%v", panicLog["request_id"], accessLog["request_id"])
	}
	if accessLog["status"] != float64(http.StatusInternalServerError) || accessLog["client_ip"] != "192.0.2.10" {
		t.Fatalf("unexpected access log: %+v", accessLog)
	}
	if strings.Contains(logs.String(), "sensitive panic value") {
		t.Fatal("panic values must not be written to logs")
	}
}

func TestSecurityLogSamplerEmitsFirstThenOnePerMinute(t *testing.T) {
	now := time.Date(2026, 7, 12, 12, 0, 0, 0, time.UTC)
	sampler := newSecurityLogSampler()
	sampler.now = func() time.Time { return now }

	if allowed, suppressed := sampler.allow("192.0.2.1|invalid_key"); !allowed || suppressed != 0 {
		t.Fatalf("first event = (%v,%d), want (true,0)", allowed, suppressed)
	}
	if allowed, _ := sampler.allow("192.0.2.1|invalid_key"); allowed {
		t.Fatal("repeated event inside the window must be suppressed")
	}
	if allowed, _ := sampler.allow("192.0.2.1|invalid_key"); allowed {
		t.Fatal("second repeated event inside the window must be suppressed")
	}
	now = now.Add(time.Minute)
	if allowed, suppressed := sampler.allow("192.0.2.1|invalid_key"); !allowed || suppressed != 2 {
		t.Fatalf("next-window event = (%v,%d), want (true,2)", allowed, suppressed)
	}
}

func TestTrustedClientIPRequiresEdgeAuthentication(t *testing.T) {
	serviceKey := "svc_test_0123456789012345678901234567890123456789012"
	tests := []struct {
		name       string
		cfg        config.Config
		wantIP     string
		setService bool
	}{
		{name: "direct local", cfg: config.Config{Env: "dev"}, wantIP: "192.0.2.20"},
		{name: "authenticated edge", cfg: config.Config{Env: "dev", RequireEdgeAuth: true, CoreServiceKey: serviceKey}, wantIP: "203.0.113.20", setService: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			server := NewServer(tt.cfg, &fakeRepository{}, slog.New(slog.NewJSONHandler(&logs, nil)))
			request := httptest.NewRequest(http.MethodPost, "/v1/components", strings.NewReader(`{}`))
			request.RemoteAddr = "192.0.2.20:4444"
			request.Header.Set(trustedClientIPHeader, "203.0.113.20")
			if tt.setService {
				request.Header.Set(serviceAuthorizationHeader, "Bearer "+serviceKey)
			}
			recorder := httptest.NewRecorder()
			server.Router().ServeHTTP(recorder, request)

			record := recordWithEvent(t, decodeLogRecords(t, logs.String()), "http_request")
			if record["client_ip"] != tt.wantIP {
				t.Fatalf("client_ip = %v, want %s; logs=%s", record["client_ip"], tt.wantIP, logs.String())
			}
		})
	}
}

func TestSuccessfulHealthRequestsOnlyEmitMetrics(t *testing.T) {
	var logs bytes.Buffer
	server := NewServer(config.Config{Env: "dev"}, nil, slog.New(slog.NewJSONHandler(&logs, nil)))

	healthRecorder := httptest.NewRecorder()
	server.Router().ServeHTTP(healthRecorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if healthRecorder.Code != http.StatusOK {
		t.Fatalf("health status = %d", healthRecorder.Code)
	}
	if strings.TrimSpace(logs.String()) != "" {
		t.Fatalf("successful health request produced access log: %s", logs.String())
	}

	metricsRecorder := httptest.NewRecorder()
	server.MetricsHandler().ServeHTTP(metricsRecorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(metricsRecorder.Body.String(), `archura_http_requests_total{method="GET",route="/healthz",status_class="2xx"} 1`) {
		t.Fatalf("health metric missing:\n%s", metricsRecorder.Body.String())
	}

	readyRecorder := httptest.NewRecorder()
	server.Router().ServeHTTP(readyRecorder, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if readyRecorder.Code != http.StatusServiceUnavailable || !strings.Contains(logs.String(), `"route":"/readyz"`) {
		t.Fatalf("failed readiness should be logged: status=%d logs=%s", readyRecorder.Code, logs.String())
	}
}

func decodeLogRecords(t *testing.T, value string) []map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(value), "\n")
	records := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		if line == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("decode log %q: %v", line, err)
		}
		records = append(records, record)
	}
	return records
}

func recordWithEvent(t *testing.T, records []map[string]any, event string) map[string]any {
	t.Helper()
	for _, record := range records {
		if record["event"] == event {
			return record
		}
	}
	t.Fatalf("event %q not found in %+v", event, records)
	return nil
}
