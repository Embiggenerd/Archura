# Plan — Platform Owner: Inspect, Fork & Free Plan (Core / Go)

Backend for the platform-owner admin surface. A different model may implement
this; editor side: `archura-editor/docs/PLAN_ADMIN_PANEL.md`.

Two capabilities, split by the data they touch:

- **Customer content (designs) → fork, never mutate.** Copy a design into a
  platform workspace to work on (by hand or with agents); the customer's design
  is untouched. Safety is isolation, not governance controls.
- **Free-plan terms (trial length, designs allowed, subdomains allowed) → edit
  in place.** No inheritance: a new org is **seeded with its own copy of every
  default free-plan value** and then owns it. Editing the default changes what
  *future* orgs get; editing an org changes *that* org. Core-only (pre-payment),
  live on refresh.

Replaces the earlier typed-action console; see §11 for what's removed.

---

## 1. Goal

A signed-in platform owner (staff) can:
1. Browse/search any organization and its designs, **read-only**, without being a
   member.
2. **Fork** any design into the platform **workspace org**; edit the fork in the
   normal editor or with agents. Forks are one-way.
3. Edit **free-plan terms** — the default free plan (seeds new orgs) and any
   individual org's terms, including "no expiry (forever)". Every value is
   re-editable; nothing is permanent. Changes show on the client's next refresh.

## 2. Staff authentication & authorization (exact)

- `accounts.staff_role text` (nullable) with a **CHECK** limiting it to
  `('platform_owner')` (extensible later). `null` = customer.
- `/v1/admin/*` guard, reusing the existing account session:
  - missing/invalid session → **401**;
  - valid session, `staff_role` null → **403**;
  - valid session, `staff_role != 'platform_owner'` → **403**;
  - `platform_owner` → may inspect/act on **any** org **without membership**.
- **Staff grant/revoke is a CLI path** (`cmd/adminctl`), not a self-service
  endpoint: `grant-staff <account>` / `revoke-staff <account>`, which also **sync
  workspace membership** (§4) and write an audit event under the **system actor
  `admin_cli`** (a shell/DB operator, not an authenticated account). The
  "no self-grant" rule is N/A — there is no self-service grant path, and running
  the CLI already implies server access. The first owner is bootstrapped with the
  same command.

## 3. Admin API enablement (fail-closed)

- Admin routes are gated by `ADMIN_API_ENABLED`, **false by default when
  `ARCHURA_ENV=prod`**. When disabled, `/v1/admin/*` returns 404.
- A test asserts production defaults reject admin routes.
- MFA / step-up + network enforcement (Cloudflare Access/VPN) are the fast-follow
  required before flipping it on in production.

## 4. Workspace org (holds forks) — must stay editable forever

Bootstrap (idempotent CLI, safe to re-run) creates-or-gets **the** platform
organization, located by a dedicated marker `organizations.is_platform_workspace`
(a partial-unique index enforces exactly one) plus a reserved slug
`archura-platform-workspace`. If that slug is already held by a **non-workspace**
org, bootstrap **fails loudly** rather than hijacking it. The workspace is
guaranteed to have:
- `is_platform_workspace = true` (the stable locator Core uses to find it);
- `caps_exempt = true` (skips design **and** site caps, §6);
- a `organization_billing` terms row with **`free_no_expiry = true`** — so the
  entitlement lifecycle never expires it to read-only and locks staff out of
  their own forks;
- **membership (owner) for every active `platform_owner`** — re-synced on every
  bootstrap run and on each `grant-staff`/`revoke-staff`.

Forks are ordinary `designs` rows in it. What we do with forks doesn't matter —
no special governance.

## 5. Fork (idempotent, provenanced, explicit state machine)

Fork = a `designs` row in the workspace org + a copy of the source artifact. Core
owns the row, idempotency, provenance, and state; the **Worker** owns R2 and does
the copy.

- **Idempotency (persisted):** the Worker supplies `idempotency_key`. It's stored
  on the fork row under a **unique constraint** alongside `source_design_id`. A
  retry with the same key returns the same fork (no dup row). Reusing a key with a
  **different** `source_design_id` → **409**. (Key scope: per platform; max 128
  chars; retained for the fork's life — the fork row *is* the operation record,
  so no separate table.)
- **State machine (single writer — the Worker — so no races):** the fork row's
  **nullable** `fork_status ∈ {pending, ready, failed}` (a non-fork design has
  `fork_status = null`).
  - Core creates the row `pending`; the insert and its audit event commit in one
    transaction.
  - The Worker copies the blob, then calls `POST /v1/admin/forks/{id}/finalize
    {status, source_artifact_kind, source_etag?, template_ref?}`; finalize and its
    audit event commit in one transaction.
  - Transitions, all driven by that one Worker (a retry is **sequential**, not
    concurrent): `pending→ready`, `pending→failed`, and `failed→ready` (a retried
    copy succeeds, replacing failure metadata). Finalize is **idempotent** — an
    identical repeat returns the existing result; a `ready` fork receiving
    **different** provenance → `409`; `ready→failed` and non-fork finalize →
    rejected.
  - **No sweeper.** An abandoned `pending` fork (a Worker that crashed mid-copy) is
    harmless platform junk — hidden from the default list and retryable via its
    idempotency key. We deliberately run **no** background reaper; that reaper was
    the only thing that could ever race the Worker. Optional cleanup, if wanted, is
    an on-demand admin command, not a concurrent process.
  - `GET /forks` returns `ready` by default; `pending`/`failed` only with
    `?state=`. Abandoned/failed blobs in the workspace namespace are harmless; a
    retry overwrites the same destination.
- **Source selection & provenance:** copy the **published** artifact; else the
  **draft**; else start from the component **template**. Recorded on the fork row:
  `source_artifact_kind ∈ {published, draft, template}`, nullable
  `source_artifact_etag` (**template forks have none**), `template_ref` (template
  id/version, when kind = template), plus `forked_from`, `source_org_id`,
  `forked_by`, `forked_at`. The source design row and blobs are only **read**.
- **What's copied (v1 boundary):** only the **one canonical artifact** selected
  above. Generated **embed modules are not copied** — they regenerate from the
  fork's artifact at publish (the editor's normal `buildEmbedModules` flow).
  **Uploaded assets are not copied**; the fork **retains references** to the
  source's asset URLs (read-only). Copying the full design namespace or assets is
  a known deferral, not v1.

## 6. Free-plan terms (no inheritance — seed then own)

- **Default free plan** — a singleton config the admin edits: `trial_days`,
  `free_design_limit`, `free_site_limit`, `free_no_expiry`. Seeded with today's
  constants (2 / 3 / 1 / false). Used **only at org creation** to stamp the org's
  own copy; editing it affects **future** orgs, never existing ones.
- **Per-org terms** on `organization_billing`, **non-null, copied from the
  default at creation**: `free_trial_days int`, `free_design_limit int`,
  `free_site_limit int`, `free_no_expiry bool`. Directly editable per org. No
  nullable-inherit.
- **Trial lifecycle vs. policy** (reusing the existing billing schema —
  `trial_started_at`, `trial_ends_at`, `serve_grace_ends_at` already exist; do
  **not** re-add them):
  - `trial_started_at` — factual, set at first deploy (existing).
  - `trial_ends_at` — computed once at start as `trial_started_at +
    organization.free_trial_days` (the org's copy), then directly editable.
  - Staff edit **`free_trial_days` before the trial starts**; **`trial_ends_at`**
    after it starts.
  - **Existing CHECKs must hold:** `trial_ends_at > trial_started_at` and
    `serve_grace_ends_at >= trial_ends_at`. An admin can't set an end *before*
    start; to hard-expire a started org they set `trial_ends_at` to now.
  - **Decision — admin expiration ends editing and serving together:** a
    `trial_ends_at` edit **also sets `serve_grace_ends_at` to the same value** (no
    lingering serve-grace for an admin-forced expiry; equality satisfies `>=`). We
    do not offer "end editing but keep serving."
  - **"Forever" = `free_no_expiry`** (resolver-level): the org stays in the free
    tier regardless of `trial_ends_at`, so the stored date can stay CHECK-valid
    while the flag overrides it. Reversible.
- **Precedence** (extend `OrganizationEntitlementFor`): **active paid subscription
  → paid grace/cancellation → free-plan terms (`trial_ends_at`/`free_no_expiry`)
  → expired.** `free_no_expiry` affects only the free-plan branch, never a paid
  subscription.
- **Effective cap = paid vs free** (the resolver picks by subscription status, as
  `designLimit` does today): an **active/trialing Basic** org uses the **paid
  limits — 10 designs, 3 sites** (the current constants, *not* unlimited); a
  **free-tier** org uses its own `free_design_limit` / `free_site_limit`; the
  **workspace** is `caps_exempt` (unlimited). Paid limits are not per-org editable
  in v1 (adding `basic_*` fields later is trivial).
- **Enforcement is row-locked** to close the count-and-create race — two org
  members creating at once can both slip under an `INSERT … SELECT count(*)` (a
  pre-existing bug in `designs.go`). Both the design cap (`CreateDesign`) and the
  **site/subdomain cap** `SELECT … FOR UPDATE` the organization row, then
  count-and-create in the same transaction. (Client-side contention — org members
  — distinct from the admin no-concurrency point.)
- **Reduction & expiry semantics:** lowering a cap below the current count blocks
  **new** creation only (never deletes); `0` = no new resources. An admin
  expiration (trial rule above) flips editing **and** serving on the next request.
- **No concurrency to control:** free-plan terms are **admin-only** (clients never
  write them) and **disjoint from the Stripe-mirrored fields** (the webhook writes
  those, never these), so there is no client, webhook, or — with a single platform
  owner — admin race on any term. No optimistic concurrency, no `If-Match`. (If
  multiple owners are ever added, two simultaneous edits to the same term are
  last-write-wins, which is fine for rare admin actions.)

## 7. Durable audit (minimal) & read-audit decision

Reusing the existing append-only `audit_log`, write **one durable event per
consequential mutation, in the same transaction as the mutation**:
- fork create and fork finalize (source org/design, `source_artifact_kind`,
  `source_etag`/`template_ref`, destination fork id, operator);
- default-plan edit and per-org terms edit (`before`/`after`, operator, `reason`
  — reason required for per-org term changes and trial extensions);
- staff grant/revoke.

**Read auditing is deliberately omitted** — inspecting orgs/designs and reading
source artifacts are high-volume and low-value to audit; the fork (which actually
*copies* content) is audited, and access logs cover the rest. This is not undo/
version — no rollback engine, no optimistic concurrency. Extend the audit action/
resource CHECKs for the new action ids.

## 8. Data model / migrations

One migration (next free number). **The `organization_billing` columns must be
added in a safe order** — never `ADD COLUMN … NOT NULL` onto a populated table:

1. Create and **seed** `default_free_plan` (singleton; fixed PK / one-row CHECK;
   non-negative CHECKs; seed 2 / 3 / 1 / false) — so the backfill has a source.
2. Add the billing columns as **NULLABLE**: `free_trial_days int`,
   `free_design_limit int`, `free_site_limit int`, `free_no_expiry bool`.
   (`trial_started_at` / `trial_ends_at` / `serve_grace_ends_at` already exist —
   do **not** re-add them.)
3. **Backfill** every existing `organization_billing` row from the seeded default;
   **insert** a billing row (copying the default) for every org lacking one.
4. **Validate** non-negative values.
5. **Set NOT NULL** on `free_trial_days`, `free_design_limit`, `free_site_limit`,
   `free_no_expiry`.
6. **Install CHECKs:** limits ≥ 0, `free_trial_days` ≥ 0.

Other additions (new tables/rows/columns — safe to add directly):
- `accounts.staff_role text` + CHECK `in ('platform_owner')`; staff lookup index.
- `organizations.caps_exempt bool not null default false`.
- `organizations.is_platform_workspace bool not null default false` + a **partial
  unique index** (`WHERE is_platform_workspace`) so exactly one exists — the stable
  locator for the workspace org (§4).
- `designs` fork columns: `forked_from text`, `source_org_id text`,
  `forked_by text`, `forked_at timestamptz`, `source_artifact_kind text` CHECK
  `in ('published','draft','template')`, `source_artifact_etag text` (nullable),
  `template_ref text`, `fork_idempotency_key text` **UNIQUE**, `fork_status text`
  (**nullable**) CHECK `in ('pending','ready','failed')`. **Existing customer
  designs have all of these null.** Provenance is retained (no hard FK to customer
  rows, so a customer delete can't orphan a fork). **Conditional CHECK constraints
  (keyed on `fork_idempotency_key`):**
  - a **fork** (`fork_idempotency_key` not null) requires `fork_status`,
    `forked_from`, `source_org_id`, `forked_by`, `forked_at`;
  - `fork_status = 'ready'` requires `source_artifact_kind`;
  - kind `published`/`draft` requires `source_artifact_etag` **and** null
    `template_ref`;
  - kind `template` requires `template_ref` **and** null `source_artifact_etag`;
  - a **non-fork** design (`fork_idempotency_key` null) has **all** fork fields
    null (`fork_status`, kind, etag, `template_ref`, and provenance).
- **Billing-row guarantee (application invariant):** create `organization_billing`
  in the **same transaction** as every `organizations` insert, copying the current
  default plan — so no org can exist without terms (the step-3 backfill covers
  pre-existing orgs).
- **Convert existing billing writers to updates:** `StartOrganizationTrial` and
  `SetStripeCustomer` currently `INSERT … ON CONFLICT` and would omit the new
  non-null `free_*` columns. Since every org now has a guaranteed billing row,
  change them to **UPDATE** that row; regression tests cover both.
- Un-hardcode the Go constants to read `default_free_plan` at org creation and
  copy its values onto the org's billing row.
- Bootstrap workspace org + memberships (§4).

## 9. API surface & contract-first phase

All under `/v1/admin/*`, staff-gated (§2), flag-gated (§3). **Phase 0 writes the
exact schemas into `openapi.json` before any handler** (keep `docs_test.go`
green). Phase 0 pins down:
- `default_free_plan` schema; valid ranges (`trial_days ≥ 0`, limits `≥ 0`, `0`
  allowed);
- **PATCH semantics (no inheritance):** omitted field = unchanged; explicit value
  = set; `null` **rejected** for non-null free-plan fields; `422` out-of-range;
- **Phase-specific trial PATCH** on `/organizations/{id}/free-plan`: before
  `trial_started_at` is set, `free_trial_days` is accepted and `trial_ends_at`
  rejected; after start, `trial_ends_at` (RFC 3339, UTC) is accepted and
  `free_trial_days` rejected; submitting **both** is always rejected;
  `trial_ends_at` may **not** be nulled (use `free_no_expiry`); a `trial_ends_at`
  edit **also sets `serve_grace_ends_at` to the same instant** (§6 decision:
  editing and serving end together); violations → `422`;
- **Finalize conflict codes:** identical retry → existing result; `ready` with
  different provenance → `409`; `ready→failed` → rejected (`409`); non-fork
  finalize → `404`;
- **Pagination everywhere a list can grow** (see endpoints below);
- fork request (`idempotency_key`) and the `finalize` body
  (`status, source_artifact_kind, source_etag?, template_ref?`);
- error schema `{ "error": { "code", "message" } }`;
- all migration CHECK/UNIQUE/conditional constraints from §8.

Endpoints:
- Reads: `GET /organizations?q=&cursor=&limit=`; `GET /organizations/{id}`
  (record + billing + **the org's free-plan terms** + **bounded** member/design
  summaries) with separate `GET /organizations/{id}/designs?cursor=&limit=` and
  `GET /organizations/{id}/members?cursor=&limit=` for the full collections;
  `GET /designs/{id}` — **record only** (R2 draft/published presence is added by
  the Worker).
- Fork: `POST /forks {source_design_id, idempotency_key}`;
  `POST /forks/{id}/finalize {status, source_artifact_kind, source_etag?,
  template_ref?}`; `GET /forks?state=&cursor=&limit=`.
- Free plan: `GET /default-plan` · `PATCH /default-plan`;
  `PATCH /organizations/{id}/free-plan` (trial field per stage above,
  `free_design_limit`, `free_site_limit`, `free_no_expiry`; `reason` required).
- Staff: `grant-staff` / `revoke-staff` via CLI (§2), not HTTP.

Status codes: `401` (no session), `403` (not platform_owner), `404` (missing, or
admin disabled), `409` (idempotency reused with a different source; conflicting
finalize), `422` (validation/range/phase).

## 10. Testing

- **Authz:** the 401/403 matrix (§2); a `platform_owner` reads a foreign org it is
  **not** a member of; any non-staff account → 403.
- **Enablement:** production defaults → `/v1/admin/*` 404.
- **Billing-row invariant:** a newly created org has a billing row copied from the
  default; the migration backfills every pre-existing org.
- **No trial leak:** create org (default `trial_days=2`), then change the default
  to 30; the org's `free_trial_days` is still 2 and its computed `trial_ends_at`
  is unaffected.
- **Fork (Core owns row/state, not R2):** source **row** unchanged; same
  idempotency key → same fork (no dup); key reused with a different source → 409;
  finalize transitions (`pending→ready`/`pending→failed`/`failed→ready`),
  identical retry idempotent, `ready` with different provenance → 409,
  `ready→failed` rejected, non-fork finalize → 404; the provenance CHECKs reject
  invalid combos (ready-without-kind, published/draft-without-etag,
  template-with-etag); template fork has null etag + `template_ref`; missing
  source → 404.
- **Fork retry (Core):** after a `pending→failed` finalize, a subsequent
  `failed→ready` finalize (same idempotency key) succeeds and its provenance wins;
  identical repeats are idempotent. (Sequential retry by the one Worker — no
  concurrent writer exists.)
- **Blob/copy correctness is Worker/E2E, not Core** (Core doesn't own R2): the
  source **blob** unchanged, correct destination copied, correct ETag supplied,
  and an end-to-end `create → copy → finalize → ready`. (See the editor plan.)
- **Free plan / caps:** `CreateDesign` honors the **effective** limit — free-tier
  reads `free_design_limit`, **active/trialing Basic reads the paid 10**, workspace
  `caps_exempt` is unlimited; same for sites (`free_site_limit` / paid 3); the
  count-and-create is **row-locked** (a concurrent double-create can't exceed the
  cap); lowering a cap blocks new but keeps existing; `0` blocks all new; an admin
  `trial_ends_at` edit also moves `serve_grace_ends_at` (editing **and** serving
  end together); `free_no_expiry` overrides the date but never a paid subscription.
- **Billing writers:** `StartOrganizationTrial` and `SetStripeCustomer` update the
  guaranteed billing row without violating the new non-null columns.
- **Workspace identity & editability:** bootstrap finds the singleton by
  `is_platform_workspace`, a slug collision with a non-workspace org fails loudly,
  re-running is idempotent; the workspace never becomes read-only
  (`free_no_expiry` + `caps_exempt`); grant/revoke syncs membership.
- **Audit:** each consequential mutation writes exactly one immutable event **in
  the mutation's transaction**; reads write none.
- `gofmt` clean; `go test ./...` + OpenAPI drift green.

## 11. Removed vs. the earlier plan

Deleted: typed-action pipeline, action/field registries, `/actions` dispatcher,
entitlement-override **inheritance**, offer catalog, Stripe-content coupling,
before/after **undo**, generic optimistic-concurrency `version` columns, R2
take-down/transfer/publish-as-operator/consent, operator sessions, MFA subsystem,
risk tiers. **Kept minimally:** durable audit events (§7) and fork state (§5) —
accountability/correctness, not the deleted governance machinery.

## 12. Phasing

0. **Contract-first** — `openapi.json` schemas, ranges, constraints, error shapes.
1. **Staff gate + enablement + reads** — `staff_role` + CHECK, guard,
   `ADMIN_API_ENABLED`, org/design reads, grant/revoke CLI, bootstrap + workspace
   org, billing-row invariant + backfill.
2. **Fork** — create/finalize/list, persisted idempotency, provenance, state
   transitions (single-writer; no sweeper).
3. **Free plan** — `default_free_plan` + per-org terms (incl. `free_trial_days`)
   + resolver wiring for **both** caps + precedence/reduction semantics + audit.
   (Independent of fork.)

## 13. Invariants (handoff checklist)

- No `/v1/admin/*` without a `platform_owner` session; none in production while
  `ADMIN_API_ENABLED` is off.
- Every organization has a `organization_billing` terms row (created in-txn;
  backfilled).
- No inheritance: caps and trial length read the org's **own copied** fields; the
  default plan only affects new orgs (proven by the no-leak test).
- Customer content is read-only; the only content writes are fork rows/blobs in
  the cap-exempt, never-expiring workspace org; forks are one-way and idempotent.
- Paid subscription always outranks free-plan terms.
- Every consequential mutation and its audit event **commit in the same database
  transaction**; reads are not audited; free-plan edits never touch Stripe.
