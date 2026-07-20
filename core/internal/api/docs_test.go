package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/archura/core/internal/config"
)

func TestOpenAPIAndInteractiveDocsAreServed(t *testing.T) {
	server := NewServer(config.Config{Env: "dev"}, nil, slog.Default())
	router := server.Router()

	specRecorder := httptest.NewRecorder()
	router.ServeHTTP(specRecorder, httptest.NewRequest(http.MethodGet, "/openapi.json", nil))
	if specRecorder.Code != http.StatusOK || specRecorder.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("openapi response = %d %q", specRecorder.Code, specRecorder.Header().Get("Content-Type"))
	}
	var spec map[string]any
	if err := json.Unmarshal(specRecorder.Body.Bytes(), &spec); err != nil {
		t.Fatalf("openapi document is invalid JSON: %v", err)
	}
	if spec["openapi"] != "3.1.0" {
		t.Fatalf("openapi version = %v", spec["openapi"])
	}

	docsRecorder := httptest.NewRecorder()
	router.ServeHTTP(docsRecorder, httptest.NewRequest(http.MethodGet, "/docs", nil))
	if docsRecorder.Code != http.StatusOK || !strings.Contains(docsRecorder.Body.String(), "swagger-ui-dist@5.32.6") {
		t.Fatalf("docs response = %d body=%s", docsRecorder.Code, docsRecorder.Body.String())
	}
	if strings.Contains(docsRecorder.Header().Get("Content-Security-Policy"), "unsafe-inline") {
		t.Fatal("docs CSP must not allow inline scripts")
	}

	initializerRecorder := httptest.NewRecorder()
	router.ServeHTTP(initializerRecorder, httptest.NewRequest(http.MethodGet, "/docs/swagger-initializer.js", nil))
	if initializerRecorder.Code != http.StatusOK || !strings.Contains(initializerRecorder.Body.String(), "'/openapi.json'") {
		t.Fatalf("initializer response = %d body=%s", initializerRecorder.Code, initializerRecorder.Body.String())
	}
}

func TestOpenAPIOperationsMatchRegisteredAPIRoutes(t *testing.T) {
	server := NewServer(config.Config{Env: "dev"}, nil, slog.Default())
	router := server.Router()
	routes, ok := router.(chi.Routes)
	if !ok {
		t.Fatal("router does not expose chi routes")
	}

	registered := make(map[string]bool)
	if err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if route == "/healthz" || route == "/readyz" || route == "/stripe/webhooks" || strings.HasPrefix(route, "/v1/") {
			registered[strings.ToLower(method)+" "+route] = true
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	var spec struct {
		Paths map[string]map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal(openAPIDocument, &spec); err != nil {
		t.Fatal(err)
	}
	documented := make(map[string]bool)
	for path, operations := range spec.Paths {
		for method := range operations {
			documented[strings.ToLower(method)+" "+path] = true
		}
	}
	if !reflect.DeepEqual(registered, documented) {
		t.Fatalf("OpenAPI route drift:\nregistered=%v\ndocumented=%v", registered, documented)
	}
}
