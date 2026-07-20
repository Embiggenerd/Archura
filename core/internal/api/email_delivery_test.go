package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestCloudflareEmailDeliveryUsesRESTContract(t *testing.T) {
	var body map[string]any
	delivery := newCloudflareEmailDelivery("account", "token", "hello@archura.ai")
	delivery.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Header.Get("Authorization") != "Bearer token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body: io.NopCloser(strings.NewReader(
				`{"success":true,"result":{"delivered":["member@example.com"]}}`,
			)),
			Header: make(http.Header),
		}, nil
	})}

	if err := delivery.deliverInvitation(context.Background(), pendingInvitationEmail{
		Email: "member@example.com", OrganizationName: "Acme Bakery",
		AccountURL: "https://archura.ai/account/?invitation=one", CreatedAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	from, ok := body["from"].(map[string]any)
	if !ok || from["address"] != "hello@archura.ai" || body["to"] != "member@example.com" ||
		body["text"] == "" || body["html"] == "" {
		t.Fatalf("unexpected email request: %+v", body)
	}
}

func TestCloudflareEmailDeliveryReportsProviderFailure(t *testing.T) {
	delivery := newCloudflareEmailDelivery("account", "token", "hello@archura.ai")
	delivery.client = &http.Client{Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusForbidden,
			Body:       io.NopCloser(strings.NewReader("sender domain unavailable")),
			Header:     make(http.Header),
		}, nil
	})}
	if err := delivery.deliverConfirmation(context.Background(), pendingConfirmation{
		Email: "owner@example.com", ConfirmURL: "https://archura.ai/confirm?token=redacted",
	}); err == nil {
		t.Fatal("provider failure must be returned")
	}
}
