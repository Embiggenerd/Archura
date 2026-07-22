# Core plan: admin accounts listing + org/account deletion (rev 5)

Companion doc: `archura-editor/docs/PLAN_OPS_TABS_AND_DELETE.md` (worker + ops UI).
Do not implement until Igor says go. Igor deploys (push to master → CI); Claude
never pushes or deploys.

Rev 2 incorporated the first review: ownerless-org rule, NULL-safe subscription
guard, NULL org reference on deletion audits, pending-invitation cleanup,
cursor pagination, typed conflict errors, 0016 down migration, email-
normalization wording, membership-count naming. Rev 3 the second: valid
two-query lock in billing→org order to match the webhook path, account-delete
locking algorithm, typed deletion-audit metadata, co-owner detach rule,
both-ordering concurrency tests. Rev 4 the third: **cleanup receipts replaced
by R2↔core reconciliation** (the pre-delete receipt was unavoidably stale;
preview data is now display-only and carries no correctness weight),
invitation→account lock order to kill the acceptance deadlock, a
machine-authenticated org-existence endpoint for the reconciliation sweep, and
the outer-join wording fix. Rev 5 the fourth: a machine-authenticated
subdomain-binding lookup (site metas do **not** reliably carry
`organizationId` — the claim flow writes meta before binding core) and, in the
companion doc, meta-last purge ordering (a partially purged site with missing
meta would otherwise serve as a "legacy" site).

Deliberately **not** adopted (single-operator console): a core-side
tombstone/outbox table, serializable isolation, advisory locks, and the
reviewer-proposed deletion-state token/ETag on previews — reconciliation makes
preview staleness harmless instead of detecting it (see companion doc).

## Why

The /ops/ console needs to list **accounts** as well as organizations, and both
must be deletable so Igor can clean up test accounts (he registers with plus
aliases like `test22+igor.atakhanov@gmail.com`). Deletion is a platform-owner
action: core owns the rows, the Worker owns R2 blobs, so core deletes rows and
tells the Worker what blob prefixes to purge (same ownership split as forks).

## Schema facts that shape the design (verified 2026-07-22)

- Every child table cascades from `organizations` / `accounts` (`ON DELETE
  CASCADE`): memberships, sessions, invitations, designs, billing,
  organization_sites, payment_components, component_sessions, api keys.
- **Exception:** `audit_log.organization_id` is `ON DELETE RESTRICT`. The delete
  transaction must first `UPDATE audit_log SET organization_id = NULL WHERE
  organization_id = $1` (keeps historical audit rows, unblocks the delete).
- `designs.forked_from` / `source_org_id` are TEXT, not FKs — forks keep their
  provenance strings after the source org is gone. Harmless; no action.
- `organization_invitations.email` has **no account FK** — invitations to the
  deleted account's email in *other* orgs survive unless deleted explicitly.
- Core normalizes emails to `ToLower(TrimSpace(...))` (accounts.go:719) and
  validates via `mail.ParseAddress`; `accounts.email` is UNIQUE on the
  normalized string. **Retain that normalization; never strip Gmail dots or
  `+tag` portions** — plus aliases are distinct accounts and are Igor's test
  mechanism.
- The platform workspace org has `is_platform_workspace` / slug
  `archura-platform-workspace` (store/admin.go) — never deletable.
- Admin pagination is `q` / `limit` / `cursor` (a stringified offset parsed by
  `adminPagination`, admin.go:78) with `next_cursor` in responses. New endpoints
  must match — no bare `offset` param.

## Endpoints (all under the existing `/v1/admin` platform_owner gate)

### 1. `GET /v1/admin/accounts?q=&limit=&cursor=`

New store method `AdminAccounts` mirroring `AdminOrganizations` (admin.go:221):
substring search on email, `AdminPage` pagination, response
`{"accounts": [...], "next_cursor": ...}`. Item fields: `id`, `email`,
`staff_role`, `created_at`, and `membership_count` — named for what it is (all
memberships), **not** a prediction of what deletion removes; the detail
endpoint below provides that.

### 2. `GET /v1/admin/accounts/{accountID}`

Deletion preview + confirm-dialog data source:

```json
{
  "id": "…", "email": "…", "staff_role": null, "created_at": "…",
  "memberships": [
    { "organization_id": "…", "slug": "…", "role": "owner",
      "member_count": 1, "sole_member": true, "last_owner": false,
      "sites": ["sub1"] }
  ]
}
```

`sole_member` marks orgs account deletion will cascade-delete; `last_owner`
(only owner, but other members exist) marks orgs that will **block** deletion.
The UI shows both before the typed confirmation. `sites` (the org's
`organization_sites` subdomains) likewise feeds the confirm dialog, and
`GET /v1/admin/organizations/{id}` gains the same `sites` array.

**The preview is display-only.** It can go stale between preview and DELETE
(sites added, memberships changed, new orgs created) and that is fine: the
DELETE recomputes everything under its transaction locks, its *response* is the
only purge input the Worker acts on immediately, and the reconciliation sweep
(companion doc) mops up anything a lost response or failed purge leaves behind.
No deletion-state token is needed because nothing downstream trusts the
preview.

### 3. `DELETE /v1/admin/organizations/{organizationID}`

All guards evaluate **inside the delete transaction** under row locks. Two
separate lock queries — Postgres rejects `FOR UPDATE` on the nullable side of
an outer join (it errors; it doesn't skip the lock), so a single left-joined
lock query is not an option:
1. `SELECT … FROM organization_billing WHERE organization_id = $1 FOR UPDATE`
   (zero rows = nothing to lock, fine);
2. `SELECT … FROM organizations WHERE id = $1 FOR UPDATE`.

**Billing first, org second — this order is load-bearing.** The Stripe webhook
path (`UpdateStripeSubscription`, billing.go:218) locks the billing row via
UPDATE and then inserts an audit row whose FK takes a KEY SHARE lock on the org
row. Locking org→billing here would deadlock against it; billing→org queues
politely. This closes the race where a webhook flips the status between guard
and delete.

Guards, in order (409s use the typed-error scheme below):
- 404 unknown org.
- 409 `platform_workspace` if `is_platform_workspace` or the platform slug.
- 409 `subscription_active` if `stripe_subscription_id IS NOT NULL AND
  stripe_subscription_status IS DISTINCT FROM 'canceled'` — `IS DISTINCT FROM`,
  not `NOT IN`: a NULL status must count as active (mid-webhook state), not
  slip through. Stripe must be canceled first; deleting rows under a live
  subscription orphans it.

Transaction: lock → guards → capture `organization_sites` subdomains → null the
org's `audit_log` refs → `DELETE FROM organizations` (FKs cascade the tree) →
audit event (see Audit section) → commit. Response
`200 {"released_sites": ["sub1", ...]}` so the Worker can purge `sites/<sub>/`
and `orgs/<id>/` from R2 (retryability is the Worker's job — see companion doc,
"reconciliation").

### 4. `DELETE /v1/admin/accounts/{accountID}`

Guards:
- 404 unknown account.
- 409 `staff_account` if `staff_role IS NOT NULL` — protects Igor's own owner
  account from console deletion; demote via adminctl first if ever needed.
- 409 `last_owner` if the account is the only **owner** of any org that has
  other members — deleting it would leave a live org nobody can administer.
  Blocked rather than auto-promoting a member: promotion is a surprising side
  effect for a test-cleanup tool, and real orgs deserve a deliberate handover.

Locking algorithm (one transaction; classification must happen under locks or
a concurrent staff grant / invitation acceptance invalidates it):
1. **Delete pending invitations for the email first**, before touching the
   account row. Invitation acceptance locks the invitation row and *then*
   inserts a membership whose FK waits on the account row (invitation →
   account). If we locked the account first and deleted invitations later, the
   orders would cross and Postgres would abort one side with a deadlock
   (40P01). Taking invitation rows first gives both paths the same
   invitation → account order, so they queue instead of deadlocking. No retry
   loop needed; and if some other transient abort ever occurs, the admin
   clicking delete again is an acceptable recovery for this tool.
2. `SELECT … FROM accounts WHERE id = $1 FOR UPDATE` — locks the account row
   *before* reading `staff_role` (a staff grant is an UPDATE on this row, so it
   queues behind us). An invitation accepted in the gap before this lock just
   produces a membership row that step 4 classifies normally.
3. Read the account's memberships, then lock every affected org **in ascending
   org-id order**, and for each org: billing row first, then org row (same
   per-org order as #3, same webhook-deadlock reason). Ascending id order makes
   concurrent multi-org deletes deadlock-free — free insurance via `ORDER BY`
   even though today there is exactly one operator.
4. Recompute member and owner counts **after** the locks are held (a membership
   INSERT takes KEY SHARE on the org row, which our FOR UPDATE blocks — counts
   are stable while we hold them), then classify: sole-member → cascade,
   last-owner-with-other-members → 409, otherwise → detach.

Cascade rule: organizations where the account is the **sole member** are
deleted inline via the same guarded routine as #3 — one atomic transaction for
the whole account delete, so if *any* cascaded org trips a guard (e.g.
`subscription_active`), the entire delete rolls back and the 409 names that
org. Orgs with other members just lose the membership row (FK cascade) — and
explicitly: an **owner** detaches freely when at least one other owner remains;
the schema permits co-owners and only the *last* owner blocks. Additionally
delete `email_confirmations` rows by normalized email (no FK). Pending
`organization_invitations` for the email are already deleted in step 1 of the
locking algorithm (deadlock ordering) — which also serves the original goal:
an account recreated with the same email must not inherit stale invitations.
Responded (accepted/declined/revoked) invitations are history and stay.

Response `200 {"deleted_organization_ids": [...], "released_sites": [...]}` for
the Worker's R2 purge.

### 5. `GET /v1/organizations/{organizationID}/exists` (machine-authenticated)

The Worker's nightly reconciliation sweep (companion doc) must ask "does this
org still exist?" without a platform-owner session. The internal entitlement
endpoint cannot be used: it 404s both for a missing org **and** for a missing
billing row, and this plan explicitly permits orgs without billing rows — an
ambiguous 404 could purge a live org's blobs. So: a dedicated existence check
under `/v1` (not `/v1/admin`), authenticated with `CORE_INTERNAL_KEY` exactly
like the entitlement/deploy-check endpoints, returning
`200 {"exists": true|false}` strictly on the `organizations` row. Boring on
purpose; ambiguity here is a data-loss bug.

### 6. `GET /v1/sites/{subdomain}/binding` (machine-authenticated)

Same auth as #5. Returns `200 {"bound": true, "organization_id": "…"}` when an
`organization_sites` row exists for the subdomain, `200 {"bound": false}`
otherwise. Needed because site `meta.json` in R2 does **not** reliably carry
`organizationId`: the claim flow writes meta first and binds core second
(site-worker.js:738–758), so a crash between the two leaves a bound site whose
meta the org-existence sweep cannot associate. This lookup lets the sweep
resolve (and backfill) such metas — companion doc, "reconciliation".

## Typed conflict errors and payload shape

The store's generic `ErrConflict` cannot carry which guard fired or which org.
Add to the store:

```go
type AdminDeleteBlocked struct {
    Code             string // "platform_workspace" | "subscription_active" | "staff_account" | "last_owner"
    OrganizationID   string // set when a specific org is the blocker
    OrganizationSlug string
}
func (e *AdminDeleteBlocked) Error() string
```

The API layer maps it with `errors.As` to the existing envelope —
`409 {"error": {"code": <Code>, "message": …}}` — where the message names the
blocking org's slug (e.g. `"Organization acme-test has an active Stripe
subscription; cancel it first."`). No new envelope fields; the UI shows the
message verbatim and can branch on the code.

## Audit — read this twice (this exact spot broke MFA)

New actions `admin.organization_deleted` and `admin.account_deleted` must be
added in **both** places or every delete 500s:
1. Migration `0016` (see below).
2. The Go whitelist in `store/audit.go` `auditMetadata()` — as a **new typed
   case**, not `EmptyAuditMetadata`: once the row is gone the UUID in
   `resource_id` is unresolvable, so the event must preserve the human identity
   of what was deleted.

```go
type DeletionAuditMetadata struct {
    Email                  string   `json:"email,omitempty"`  // account deletes
    Slug                   string   `json:"slug,omitempty"`   // organization deletes
    DeletedOrganizationIDs []string `json:"deleted_organization_ids,omitempty"` // account deletes
}
```

Event shape — the FK trap: `audit_log.organization_id` references
`organizations`, and the org is gone by the time the event inserts (same tx,
post-DELETE). So deletion events must set `OrganizationID: ""` (insertAudit's
`NULLIF` turns it into SQL NULL) and carry the deleted id in `resource_id`
(TEXT, no FK) with `resource_type: "organization"` / `"account"`.

Account deletion emits **one `admin.organization_deleted` per cascaded org**
plus one final `admin.account_deleted`, all in the same transaction — the audit
trail records exactly what disappeared even though the response only lists ids.

## Migration 0016 — up and down

- **Up:** drop + re-add `audit_log_action_check` with the two new actions
  appended to the 0015 list (follow the 0014/0015 pattern).
- **Down:** `DELETE FROM audit_log WHERE action IN ('admin.organization_deleted',
  'admin.account_deleted')` **first**, then restore the 0015 constraint —
  restoring the check with those rows present would fail validation.

## Also required

- OpenAPI entries for all six endpoints — the route-drift test fails
  otherwise — including the new `sites` arrays on the org-detail and
  account-detail schemas (no deletion-state token exists to document).
  `AdminOrganization` responses already include `slug` (displayed in the UI and
  used as the typed delete confirmation); keep it present.
- `adminRepository` interface (api/admin.go) gains `AdminAccounts`,
  `AdminAccountByID`, `DeleteOrganization`, `DeleteAccount`; extend
  `fakeRepository` (api/identity_test.go), including its `AdminDeleteBlocked`
  returns so API tests can cover every 409 branch.

## Tests

- API (fakeRepository): gate matrix (anon 401 / non-staff 403 / staff 200);
  each 409 code surfaces with the right payload; delete responses carry the
  R2-purge fields; account-detail preview marks `sole_member` / `last_owner`.
- `auditMetadata` unit test accepts both new actions (pure Go, no DB — this is
  the check whose absence shipped the MFA breakage).
- Store-level (guarded by `TEST_DATABASE_URL`, like `TestMigrateIdempotent`):
  - org delete: tree gone, historical audit rows preserved with NULLed org ref,
    deletion event inserted with NULL organization_id and resource_id = org id;
  - NULL `stripe_subscription_status` with a subscription id → blocked;
  - concurrency, **both orderings**: delete first → the webhook-style billing
    update waits and observes the deletion (zero rows); webhook first → the
    delete waits and re-evaluates the *resulting* status (a just-activated
    subscription blocks it);
  - account delete: sole-member orgs cascade; `last_owner` org blocks; a
    blocking org anywhere rolls back the **whole** account delete atomically;
    pending invitations and confirmations for the email are gone, responded
    invitations remain;
  - invitation-acceptance concurrency: an acceptance and an account delete
    running together complete without deadlock in either start order (the
    shared invitation → account lock order is the fix under test), with the
    membership either deleted with the account or never created;
  - the existence endpoint: org with no billing row → `exists: true`; deleted
    org → `exists: false` (the ambiguity that rules out the entitlement
    endpoint);
  - the binding endpoint: bound subdomain → its org id; unbound or
    never-claimed subdomain → `bound: false`; subdomain of a just-deleted org
    → `bound: false` (the cascade removed `organization_sites`).

## Verification before handing to Igor

`go build ./... && go vet ./... && go test ./...` green, plus a rolled-back
dry-run of migration 0016's **up** against the prod schema (`BEGIN; …;
ROLLBACK;` over ssh, changes nothing) — the server exits on failed migrations,
so a bad 0016 is a prod outage.
