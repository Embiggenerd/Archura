package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/archura/core/internal/store"
)

func TestDesignCreateListGetAndCap(t *testing.T) {
	repo, server, token, organizationID := billingTestServer(t, "owner")
	router := server.Router()
	create := func() *httptest.ResponseRecorder {
		return performRequest(router, http.MethodPost,
			"/v1/organizations/"+organizationID+"/designs", `{"name":"Splash","component_path":"pages/Landing"}`, token)
	}

	// Free floor is 3 designs; the 4th is rejected with a distinct code so the
	// editor can show the upgrade modal.
	for i := 0; i < 3; i++ {
		if resp := create(); resp.Code != http.StatusCreated {
			t.Fatalf("create design %d: status=%d body=%s", i, resp.Code, resp.Body.String())
		}
	}
	capped := create()
	if capped.Code != http.StatusConflict || !containsJSON(capped.Body.String(), `"code":"design_limit_reached"`) {
		t.Fatalf("4th design not capped: status=%d body=%s", capped.Code, capped.Body.String())
	}

	// Basic raises the cap to 10.
	repo.billing = map[string]store.OrganizationBilling{organizationID: {
		OrganizationID: organizationID, StripeSubscriptionStatus: "active",
	}}
	if resp := create(); resp.Code != http.StatusCreated {
		t.Fatalf("Basic create beyond free cap: status=%d body=%s", resp.Code, resp.Body.String())
	}

	list := performRequest(router, http.MethodGet, "/v1/organizations/"+organizationID+"/designs", "", token)
	if list.Code != http.StatusOK || !containsJSON(list.Body.String(), `"designs"`, `"pages/Landing"`) {
		t.Fatalf("list designs: status=%d body=%s", list.Code, list.Body.String())
	}

	created := repo.designs[organizationID][0]
	got := performRequest(router, http.MethodGet,
		"/v1/organizations/"+organizationID+"/designs/"+created.ID, "", token)
	if got.Code != http.StatusOK || !containsJSON(got.Body.String(), created.ID) {
		t.Fatalf("get design: status=%d body=%s", got.Code, got.Body.String())
	}

	missing := performRequest(router, http.MethodGet,
		"/v1/organizations/"+organizationID+"/designs/dsn_00000000000000000000000000000000", "", token)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("get unknown design: status=%d", missing.Code)
	}
}

func TestDesignRequiresOrganizationMembership(t *testing.T) {
	_, server, token, organizationID := billingTestServer(t, "owner")
	router := server.Router()

	noSession := performRequest(router, http.MethodGet, "/v1/organizations/"+organizationID+"/designs", "", "")
	if noSession.Code != http.StatusUnauthorized {
		t.Fatalf("designs without a session: status=%d", noSession.Code)
	}
	otherOrg := performRequest(router, http.MethodGet, "/v1/organizations/not-a-member-org/designs", "", token)
	if otherOrg.Code != http.StatusNotFound {
		t.Fatalf("designs for a non-membership org: status=%d", otherOrg.Code)
	}
}

func TestDesignComponentTierAndPathValidation(t *testing.T) {
	t.Run("absent path defaults to page", func(t *testing.T) {
		_, server, token, organizationID := billingTestServer(t, "owner")
		response := performRequest(server.Router(), http.MethodPost,
			"/v1/organizations/"+organizationID+"/designs", `{"name":"Default page"}`, token)
		if response.Code != http.StatusCreated || !containsJSON(response.Body.String(), `"component_path":"pages/Landing"`) {
			t.Fatalf("default page status=%d body=%s", response.Code, response.Body.String())
		}
	})

	t.Run("free standalone component denied", func(t *testing.T) {
		_, server, token, organizationID := billingTestServer(t, "owner")
		response := performRequest(server.Router(), http.MethodPost,
			"/v1/organizations/"+organizationID+"/designs",
			`{"name":"Card","component_path":"cards/Card"}`, token)
		if response.Code != http.StatusPaymentRequired ||
			!containsJSON(response.Body.String(), `"code":"component_requires_paid"`) {
			t.Fatalf("free component status=%d body=%s", response.Code, response.Body.String())
		}
	})

	t.Run("paid standalone component allowed", func(t *testing.T) {
		repo, server, token, organizationID := billingTestServer(t, "owner")
		repo.billing = map[string]store.OrganizationBilling{organizationID: {
			OrganizationID: organizationID, StripeSubscriptionStatus: "active",
		}}
		response := performRequest(server.Router(), http.MethodPost,
			"/v1/organizations/"+organizationID+"/designs",
			`{"name":"Card","component_path":"cards/Card"}`, token)
		if response.Code != http.StatusCreated {
			t.Fatalf("paid component status=%d body=%s", response.Code, response.Body.String())
		}
	})

	for name, body := range map[string]string{
		"null":      `{"component_path":null}`,
		"empty":     `{"component_path":""}`,
		"malformed": `{"component_path":"pages/../Landing"}`,
		"unknown":   `{"component_path":"pages/Unknown"}`,
	} {
		t.Run("invalid "+name, func(t *testing.T) {
			_, server, token, organizationID := billingTestServer(t, "owner")
			response := performRequest(server.Router(), http.MethodPost,
				"/v1/organizations/"+organizationID+"/designs", body, token)
			if response.Code != http.StatusUnprocessableEntity ||
				!containsJSON(response.Body.String(), `"code":"invalid_component_path"`) {
				t.Fatalf("invalid path status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}
