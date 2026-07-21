# Plan — Finish the sprint (core)

Close the remaining admin-console polish and the prod-readiness gate. Editor side:
`archura-editor/docs/PLAN_FINISH.md`.

**Where core stands:** the admin console (inspect / fork / free-plan) is
implemented and its tests are green — migration `0012`, the admin API + store,
`adminctl`, the row-locked caps, and the customer billing response now carrying
`free_*` terms. **The client design-mode work needs no new core endpoints**: a
platform owner edits a fork through the normal org-scoped design routes (they're a
member of the workspace org), and the editor mounts a design from its artifact
(which carries `component_path`). So this plan is deliberately small.

---

## Phase 1 — Admin polish

- **Org search by owner email** — extend `AdminOrganizations` (the `q` filter) to
  also match an owner account's email, via a join to `organization_memberships` +
  `accounts` (currently only id / name / slug). Add a test. This is the one gap
  called out against the admin plan.
- **(Optional) single-design load for design-mode** — the editor mounts a design
  from its artifact blob (`component_path` is in the artifact), so it does **not**
  need a design-row fetch. Only if we later want a metadata-first load: the
  customer route `GET /v1/organizations/{org}/designs/{id}` already exists
  (`DesignForOrganization`) — no work unless the editor plan requests it.

## Phase 2 — Prod-readiness gate (required before any non-local exposure)

The admin API is fail-closed in prod (`ADMIN_API_ENABLED` off) by design. Before
turning it on in production:
- **Step-up / MFA on the operator session**, or front `/v1/admin/*` with
  **Cloudflare Access / VPN** — the plan's deferred requirement.
- A test asserting production defaults still reject `/v1/admin/*`.
- **Decision for the sprint:** if the console stays dev-only, this is out of scope
  and stays deferred (state it explicitly at sign-off). If "ship to prod" is in
  scope, this is a blocker.

## Phase 3 — Data + coordination

- **(Optional) stale-trial migration** — historical orgs carry a `trial_ends_at`
  computed under the old 30-day window while `free_trial_days` is now 2/3. A one-
  off `UPDATE organization_billing SET trial_ends_at = LEAST(trial_ends_at,
  trial_started_at + (free_trial_days || ' days')::interval), serve_grace_ends_at
  = <same>` (scoped or global per decision). Purely cosmetic; call it in or out.
- **Reconcile with the editor changes** — the editor sprint added `free_*` fields
  to `billingResponse` + `openapi.json` (for the data-driven dashboard) and passes
  `site_limit_reached` through. These are additive; confirm they don't collide
  with in-flight admin work and keep `go test ./...` + the OpenAPI drift test
  green.

## Testing

- `gofmt` clean; `go test ./...` + OpenAPI drift green.
- New: the org search-by-email test (Phase 1); the prod-defaults-reject test
  (Phase 2, if in scope).

## Verdict / sequencing

Core is ~done. **Phase 1 (search-by-email)** is the only functional gap and is
small. **Phase 2 (MFA/access)** is a go/no-go decision tied to whether the sprint
ships the console beyond localhost. Phase 3 is optional/coordination. The bulk of
"finish everything" lives in the editor plan (design-mode editor and the design
client surface).
