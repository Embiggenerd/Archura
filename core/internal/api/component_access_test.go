package api

import (
	"net/http"
	"testing"

	"github.com/archura/core/internal/store"
)

func TestDeployCheckTierRules(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		paid       bool
		capsExempt bool
		wantStatus int
	}{
		{name: "free page with frontend components", body: `{"top_level":"pages/Landing","uses":["cards/Card","heroes/Hero"]}`, wantStatus: http.StatusOK},
		{name: "free page with backend component", body: `{"top_level":"pages/Landing","uses":["payments/StripePayment"]}`, wantStatus: http.StatusPaymentRequired},
		{name: "free standalone component", body: `{"top_level":"cards/Card","uses":[]}`, wantStatus: http.StatusPaymentRequired},
		{name: "paid backend component", body: `{"top_level":"payments/StripePayment","uses":[]}`, paid: true, wantStatus: http.StatusOK},
		{name: "caps exempt component", body: `{"top_level":"cards/Card","uses":[]}`, capsExempt: true, wantStatus: http.StatusOK},
		{name: "unknown path fails closed for paid", body: `{"top_level":"pages/Unknown","uses":[]}`, paid: true, wantStatus: http.StatusPaymentRequired},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repo, server, _, organizationID := billingTestServer(t, "owner")
			if test.paid {
				repo.billing = map[string]store.OrganizationBilling{organizationID: {
					OrganizationID: organizationID, StripeSubscriptionStatus: "active",
				}}
			}
			if test.capsExempt {
				organization := repo.organizations["account-billing"][0]
				organization.CapsExempt = true
				repo.organizations["account-billing"][0] = organization
			}
			response := performRequest(server.Router(), http.MethodPost,
				"/v1/organizations/"+organizationID+"/deploy-check", test.body, server.cfg.CoreInternalKey)
			if response.Code != test.wantStatus {
				t.Fatalf("status=%d want=%d body=%s", response.Code, test.wantStatus, response.Body.String())
			}
			if test.wantStatus == http.StatusPaymentRequired &&
				!containsJSON(response.Body.String(), `"code":"component_requires_paid"`, `"message":"This component needs the Basic plan."`) {
				t.Fatalf("payment-required body=%s", response.Body.String())
			}
		})
	}
}

func TestDeployCheckAuthAndValidation(t *testing.T) {
	_, server, sessionToken, organizationID := billingTestServer(t, "owner")
	router := server.Router()
	path := "/v1/organizations/" + organizationID + "/deploy-check"
	body := `{"top_level":"pages/Landing","uses":[]}`

	for name, token := range map[string]string{"missing": "", "customer session": sessionToken} {
		t.Run(name, func(t *testing.T) {
			response := performRequest(router, http.MethodPost, path, body, token)
			if response.Code != http.StatusUnauthorized ||
				!containsJSON(response.Body.String(), `"code":"invalid_internal_key"`) {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}

	for name, invalidBody := range map[string]string{
		"missing top level": `{}`,
		"malformed nested":  `{"top_level":"pages/Landing","uses":["pages/../Landing"]}`,
	} {
		t.Run(name, func(t *testing.T) {
			response := performRequest(router, http.MethodPost, path, invalidBody, server.cfg.CoreInternalKey)
			if response.Code != http.StatusUnprocessableEntity ||
				!containsJSON(response.Body.String(), `"code":"invalid_component_manifest"`) {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}

	missingOrganization := performRequest(router, http.MethodPost,
		"/v1/organizations/missing/deploy-check", body, server.cfg.CoreInternalKey)
	if missingOrganization.Code != http.StatusNotFound {
		t.Fatalf("missing organization status=%d body=%s", missingOrganization.Code, missingOrganization.Body.String())
	}
}
