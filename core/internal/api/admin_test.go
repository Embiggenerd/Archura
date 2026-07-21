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
	account := repository.accounts["staff-account"]
	account.StaffRole = "platform_owner"
	repository.accounts[account.ID] = account
	staff := performRequest(server.Router(), http.MethodGet, "/v1/admin/organizations", "", token)
	if staff.Code != http.StatusOK || !containsJSON(staff.Body.String(), repository.organization.ID) {
		t.Fatalf("staff foreign-org read status=%d body=%s", staff.Code, staff.Body.String())
	}

	disabled := NewServer(config.Config{Env: "prod", AdminAPIEnabled: false, RequireEdgeAuth: true}, repository, slog.Default())
	hidden := performRequest(disabled.Router(), http.MethodGet, "/v1/admin/organizations", "", token)
	if hidden.Code != http.StatusNotFound {
		t.Fatalf("disabled admin status=%d", hidden.Code)
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
			Billing: store.OrganizationBilling{FreeTrialDays: 2, FreeDesignLimit: 3, FreeSiteLimit: 1},
		},
	}, token
}
