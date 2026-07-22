package api

import (
	"context"
	"log/slog"
	"net/http"
	"testing"
	"time"

	archauth "github.com/archura/core/internal/auth"
	"github.com/archura/core/internal/config"
	"github.com/archura/core/internal/store"
)

type adminTestRepository struct {
	*fakeRepository
	organization store.AdminOrganization
	account      store.AdminAccountDetail
	deleteErr    error
}

func (f *adminTestRepository) AdminAccounts(context.Context, string, int, int) (store.AdminPage[store.AdminAccount], error) {
	return store.AdminPage[store.AdminAccount]{Items: []store.AdminAccount{f.account.AdminAccount}}, nil
}
func (f *adminTestRepository) AdminAccountByID(_ context.Context, id string) (store.AdminAccountDetail, error) {
	if id != f.account.ID {
		return store.AdminAccountDetail{}, store.ErrNotFound
	}
	return f.account, nil
}

func (f *adminTestRepository) AdminOrganizations(context.Context, string, int, int) (store.AdminPage[store.AdminOrganization], error) {
	return store.AdminPage[store.AdminOrganization]{Items: []store.AdminOrganization{f.organization}}, nil
}
func (f *adminTestRepository) AdminOrganizationByID(_ context.Context, id string) (store.AdminOrganization, error) {
	if id != f.organization.ID {
		return store.AdminOrganization{}, store.ErrNotFound
	}
	return f.organization, nil
}
func (*adminTestRepository) AdminOrganizationMembers(context.Context, string, int, int) (store.AdminPage[store.AdminOrganizationMember], error) {
	return store.AdminPage[store.AdminOrganizationMember]{Items: []store.AdminOrganizationMember{}}, nil
}
func (*adminTestRepository) AdminOrganizationDesigns(context.Context, string, int, int) (store.AdminPage[store.Design], error) {
	return store.AdminPage[store.Design]{Items: []store.Design{}}, nil
}
func (*adminTestRepository) AdminDesignByID(context.Context, string) (store.Design, error) {
	return store.Design{}, store.ErrNotFound
}
func (*adminTestRepository) AdminForks(context.Context, string, int, int) (store.AdminPage[store.Design], error) {
	return store.AdminPage[store.Design]{Items: []store.Design{}}, nil
}
func (*adminTestRepository) CreateFork(context.Context, string, string, string, store.AuditEvent) (store.Design, error) {
	return store.Design{}, nil
}
func (*adminTestRepository) FinalizeFork(context.Context, string, store.ForkFinalize, store.AuditEvent) (store.Design, error) {
	return store.Design{}, nil
}
func (*adminTestRepository) DefaultFreePlan(context.Context) (store.DefaultFreePlan, error) {
	return store.DefaultFreePlan{TrialDays: 2, FreeDesignLimit: 3, FreeSiteLimit: 1}, nil
}
func (*adminTestRepository) UpdateDefaultFreePlan(context.Context, store.FreePlanPatch, store.AuditEvent) (store.DefaultFreePlan, error) {
	return store.DefaultFreePlan{}, nil
}
func (f *adminTestRepository) UpdateOrganizationFreePlan(_ context.Context, _ string, _ store.OrganizationFreePlanPatch, _ store.AuditEvent) (store.OrganizationBilling, error) {
	return f.organization.Billing, nil
}
func (f *adminTestRepository) DeleteOrganization(context.Context, string, store.AuditEvent) (store.AdminOrganizationDeleteResult, error) {
	if f.deleteErr != nil {
		return store.AdminOrganizationDeleteResult{}, f.deleteErr
	}
	return store.AdminOrganizationDeleteResult{ReleasedSites: []string{"released-site"}}, nil
}
func (f *adminTestRepository) DeleteAccount(context.Context, string, store.AuditEvent) (store.AdminAccountDeleteResult, error) {
	if f.deleteErr != nil {
		return store.AdminAccountDeleteResult{}, f.deleteErr
	}
	return store.AdminAccountDeleteResult{
		DeletedOrganizationIDs: []string{f.organization.ID}, ReleasedSites: []string{"released-site"},
	}, nil
}

func TestAdminGateMatrixAndForeignOrganizationRead(t *testing.T) {
	repository, token := newAdminTestRepository(t, "")
	server := NewServer(config.Config{Env: "dev", AdminAPIEnabled: true}, repository, slog.Default())

	missing := performRequest(server.Router(), http.MethodGet, "/v1/admin/organizations", "", "")
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("missing session status=%d", missing.Code)
	}
	customer := performRequest(server.Router(), http.MethodGet, "/v1/admin/organizations", "", token)
	if customer.Code != http.StatusForbidden {
		t.Fatalf("customer status=%d body=%s", customer.Code, customer.Body.String())
	}
	customerContext := performRequest(server.Router(), http.MethodGet, "/v1/admin/context", "", token)
	if customerContext.Code != http.StatusForbidden {
		t.Fatalf("customer context status=%d body=%s", customerContext.Code, customerContext.Body.String())
	}
	account := repository.accounts["staff-account"]
	account.StaffRole = "platform_owner"
	repository.accounts[account.ID] = account
	staff := performRequest(server.Router(), http.MethodGet, "/v1/admin/organizations", "", token)
	if staff.Code != http.StatusOK || !containsJSON(staff.Body.String(), repository.organization.ID) {
		t.Fatalf("staff foreign-org read status=%d body=%s", staff.Code, staff.Body.String())
	}
	accounts := performRequest(server.Router(), http.MethodGet, "/v1/admin/accounts", "", token)
	if accounts.Code != http.StatusOK || !containsJSON(accounts.Body.String(), repository.account.Email) {
		t.Fatalf("staff account read status=%d body=%s", accounts.Code, accounts.Body.String())
	}
	contextResponse := performRequest(server.Router(), http.MethodGet, "/v1/admin/context", "", token)
	if contextResponse.Code != http.StatusOK || !containsJSON(contextResponse.Body.String(), `"env":"dev"`) {
		t.Fatalf("staff context status=%d body=%s", contextResponse.Code, contextResponse.Body.String())
	}
	if cacheControl := contextResponse.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("staff context Cache-Control=%q, want no-store", cacheControl)
	}

	disabled := NewServer(config.Config{Env: "prod", AdminAPIEnabled: false, RequireEdgeAuth: true}, repository, slog.Default())
	hidden := performRequest(disabled.Router(), http.MethodGet, "/v1/admin/organizations", "", token)
	if hidden.Code != http.StatusNotFound {
		t.Fatalf("disabled admin status=%d", hidden.Code)
	}
}

func TestAdminAccountPreviewAndDeleteResponses(t *testing.T) {
	repository, token := newAdminTestRepository(t, "platform_owner")
	server := NewServer(config.Config{Env: "dev", AdminAPIEnabled: true}, repository, slog.Default())

	preview := performRequest(server.Router(), http.MethodGet, "/v1/admin/accounts/"+repository.account.ID, "", token)
	if preview.Code != http.StatusOK || !containsJSON(preview.Body.String(),
		`"sole_member":true`, `"last_owner":true`, `"sites":["released-site"]`, `"membership_count":2`,
	) {
		t.Fatalf("account preview status=%d body=%s", preview.Code, preview.Body.String())
	}

	accountDelete := performRequest(server.Router(), http.MethodDelete, "/v1/admin/accounts/"+repository.account.ID, "", token)
	if accountDelete.Code != http.StatusOK || !containsJSON(accountDelete.Body.String(),
		`"deleted_organization_ids":["`+repository.organization.ID+`"]`, `"released_sites":["released-site"]`,
	) {
		t.Fatalf("account delete status=%d body=%s", accountDelete.Code, accountDelete.Body.String())
	}

	organizationDelete := performRequest(server.Router(), http.MethodDelete, "/v1/admin/organizations/"+repository.organization.ID, "", token)
	if organizationDelete.Code != http.StatusOK || !containsJSON(organizationDelete.Body.String(), `"released_sites":["released-site"]`) {
		t.Fatalf("organization delete status=%d body=%s", organizationDelete.Code, organizationDelete.Body.String())
	}
}

func TestAdminDeleteTypedConflicts(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		blocked *store.AdminDeleteBlocked
		message string
	}{
		{
			name: "platform workspace", path: "/v1/admin/organizations/00000000-0000-0000-0000-000000000111",
			blocked: &store.AdminDeleteBlocked{Code: "platform_workspace", OrganizationSlug: "archura-platform-workspace"},
			message: "The platform workspace cannot be deleted.",
		},
		{
			name: "active subscription", path: "/v1/admin/organizations/00000000-0000-0000-0000-000000000111",
			blocked: &store.AdminDeleteBlocked{Code: "subscription_active", OrganizationSlug: "paid-test"},
			message: "Organization paid-test has an active Stripe subscription; cancel it first.",
		},
		{
			name: "staff account", path: "/v1/admin/accounts/00000000-0000-0000-0000-000000000222",
			blocked: &store.AdminDeleteBlocked{Code: "staff_account"},
			message: "Staff accounts must be demoted before deletion.",
		},
		{
			name: "last owner", path: "/v1/admin/accounts/00000000-0000-0000-0000-000000000222",
			blocked: &store.AdminDeleteBlocked{Code: "last_owner", OrganizationSlug: "shared-test"},
			message: "Organization shared-test needs another owner before this account can be deleted.",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			repository, token := newAdminTestRepository(t, "platform_owner")
			repository.deleteErr = test.blocked
			server := NewServer(config.Config{Env: "dev", AdminAPIEnabled: true}, repository, slog.Default())
			response := performRequest(server.Router(), http.MethodDelete, test.path, "", token)
			if response.Code != http.StatusConflict || !containsJSON(response.Body.String(),
				`"code":"`+test.blocked.Code+`"`, `"message":"`+test.message+`"`,
			) {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestInternalOrganizationAndSiteLookups(t *testing.T) {
	internalKey, err := archauth.Generate("int", "dev")
	if err != nil {
		t.Fatal(err)
	}
	organizationID := "00000000-0000-0000-0000-000000000333"
	repository := &fakeRepository{
		organization: store.Organization{ID: organizationID},
		sites:        map[string]string{"bound-site": organizationID},
	}
	server := NewServer(config.Config{Env: "dev", CoreInternalKey: internalKey}, repository, slog.Default())

	unauthorized := performRequest(server.Router(), http.MethodGet, "/v1/organizations/"+organizationID+"/exists", "", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized existence status=%d body=%s", unauthorized.Code, unauthorized.Body.String())
	}
	for path, want := range map[string]string{
		"/v1/organizations/" + organizationID + "/exists":               `"exists":true`,
		"/v1/organizations/00000000-0000-0000-0000-000000000444/exists": `"exists":false`,
		"/v1/sites/bound-site/binding":                                  `"organization_id":"` + organizationID + `"`,
		"/v1/sites/unbound-site/binding":                                `"bound":false`,
	} {
		response := performRequest(server.Router(), http.MethodGet, path, "", internalKey)
		if response.Code != http.StatusOK || !containsJSON(response.Body.String(), want) {
			t.Fatalf("lookup %s status=%d body=%s", path, response.Code, response.Body.String())
		}
		if cacheControl := response.Header().Get("Cache-Control"); cacheControl != "no-store" {
			t.Fatalf("lookup %s Cache-Control=%q, want no-store", path, cacheControl)
		}
	}
}

func TestAdminFreePlanValidationByTrialStage(t *testing.T) {
	input := organizationPlanPatchRequest{FreeTrialDays: []byte("30"), Reason: "Extend evaluation"}
	patch, ok := parseOrganizationPlanPatch(input, store.OrganizationBilling{})
	if !ok || patch.FreeTrialDays == nil || *patch.FreeTrialDays != 30 {
		t.Fatalf("before-start patch rejected: %+v", patch)
	}
	input.TrialEndsAt = []byte(`"2026-08-01T00:00:00Z"`)
	if _, ok := parseOrganizationPlanPatch(input, store.OrganizationBilling{}); ok {
		t.Fatal("before-start trial_ends_at accepted")
	}

	started := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	input = organizationPlanPatchRequest{TrialEndsAt: []byte(`"2026-08-01T00:00:00Z"`), Reason: "Extend evaluation"}
	patch, ok = parseOrganizationPlanPatch(input, store.OrganizationBilling{TrialStartedAt: &started})
	if !ok || patch.TrialEndsAt == nil {
		t.Fatalf("started trial end rejected: %+v", patch)
	}
	input.FreeTrialDays = []byte("30")
	if _, ok := parseOrganizationPlanPatch(input, store.OrganizationBilling{TrialStartedAt: &started}); ok {
		t.Fatal("post-start free_trial_days accepted")
	}
}

func TestFinalizeProvenanceValidation(t *testing.T) {
	valid := finalizeForkRequest{Status: "ready", SourceArtifactKind: "published", SourceETag: "etag-1"}
	if !validFinalize(valid) {
		t.Fatal("valid published provenance rejected")
	}
	valid.SourceETag = ""
	if validFinalize(valid) {
		t.Fatal("published provenance without etag accepted")
	}
	if !validFinalize(finalizeForkRequest{Status: "failed"}) {
		t.Fatal("plain failed finalize rejected")
	}
}

func newAdminTestRepository(t *testing.T, staffRole string) (*adminTestRepository, string) {
	t.Helper()
	token, err := archauth.Generate("sess", "dev")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	base := &fakeRepository{
		accounts: map[string]store.Account{"staff-account": {
			ID: "staff-account", Email: "staff@example.com", StaffRole: staffRole, CreatedAt: now,
		}},
		accountSessions: map[string]store.AccountSession{archauth.Hash(token): {
			ID: "staff-session", AccountID: "staff-account", ExpiresAt: now.Add(time.Hour), CreatedAt: now,
		}},
	}
	return &adminTestRepository{
		fakeRepository: base,
		organization: store.AdminOrganization{
			Organization: store.Organization{
				ID: "00000000-0000-0000-0000-000000000111", Name: "Foreign Business",
				Slug: "foreign-business", Status: "active", CreatedAt: now,
			},
			Sites:   []string{"released-site"},
			Billing: store.OrganizationBilling{FreeTrialDays: 2, FreeDesignLimit: 3, FreeSiteLimit: 1},
		},
		account: store.AdminAccountDetail{
			AdminAccount: store.AdminAccount{
				ID: "00000000-0000-0000-0000-000000000222", Email: "test+ops@example.com", CreatedAt: now,
				MembershipCount: 2,
			},
			Memberships: []store.AdminAccountMembership{
				{
					OrganizationID: "00000000-0000-0000-0000-000000000111", Slug: "foreign-business",
					Role: "owner", MemberCount: 1, SoleMember: true, Sites: []string{"released-site"},
				},
				{
					OrganizationID: "00000000-0000-0000-0000-000000000112", Slug: "shared-business",
					Role: "owner", MemberCount: 2, LastOwner: true, Sites: []string{},
				},
			},
		},
	}, token
}
