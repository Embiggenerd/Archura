# Plan — Finish the sprint (archura-editor)

> **STATUS (2026-07-21): COMPLETE.** All items landed and tested — deploy-check on
> every publish path (design publish, site publish, confirmation promotion), the
> Designs dashboard card + design-cap upgrade modal, the mid-session 402 → upgrade
> modal in design mode, the `/ops/` env badge reading core `GET /v1/admin/context`,
> and step-up MFA for prod (core TOTP + gate, worker `/api/ops/mfa/*` proxy, ops
> step-up/enrollment UI). Core additions: org search-by-owner-email, the
> stale-trial cleanup migration (0013), and admin MFA (migration 0014 + `internal/totp`).
> Verified: full core `go test ./...` green against live Postgres (migrations
> 0013/0014 apply); all worker unit suites; the browser `verify-ops-panel` (incl.
> the MFA step-up scenario), `verify-responsive`, `verify-stripe`. Pre-existing
> unrelated red suites (`verify-breakpoints`, `verify-invariants`,
> `verify-deploy`, `verify-client-styling`) are noted below, not caused by this work.


Make the platform-owner admin console fully usable end to end: forks you can
actually open and edit, designs as a first-class client entity, the design-cap
boundary, the remaining loose ends, and a live validation. Core side:
`core/PLAN_FINISH.md`.

**What's already done** (context): the store refactor + draft/publish lifecycle,
the `/ops/` admin console (browse, fork orchestration, free-plan editing), the
data-driven dashboard billing copy, and the shared upgrade modal at the site-cap
and time-limit boundaries.

**What blocks "done":** the editor only opens **sites** (`?site=`), so a forked
design can't be opened, designs have no client surface, and the design cap is
dormant. This plan builds the design client surface on top of core's existing
design routes.

**Contract (already exists — no new core needed):** the Worker proxies
`GET/POST /api/orgs/<org>/designs` (list/create) and serves the design artifact at
`GET/PUT /api/orgs/<org>/designs/<id>/artifact` (+ `/embed/<name>`). Core's
`CreateDesign` enforces the cap and returns `409 design_limit_reached`. The
canonical artifact carries `config.componentPath`, so the editor can mount from
the artifact alone.

---

## Phase 1 — Design-mode editor (the keystone; unblocks forks)

`/edit/?design=<id>&org=<orgId>` opens a design the same way `?site=` opens a site.

- **Explicit draft/publish Worker routes** (replace today's single autosave
  `PUT …/artifact`, so autosave is never mistaken for publication):
  - `PUT /api/orgs/<org>/designs/<id>/artifact/draft` — save draft; **no tier
    check**.
  - `POST /api/orgs/<org>/designs/<id>/publish` — run `deploy-check` on the draft's
    declared manifest; on allow, promote the draft to `artifact.json` **and write
    its embed modules in the same operation**, then delete the draft.
  - `GET /api/orgs/<org>/designs/<id>/artifact` — draft if present, else the
    published artifact (editor restoration). Public/embed serving reads only
    `artifact.json`.
- **`createDesignStore({ organizationId, designId })`** — an `ArchuraStore` over
  those routes. A design has exactly **one** artifact, so `get` → the draft-first
  GET, `put` → the draft PUT, and Publish → the `POST …/publish` op. Reuses
  `ArchuraEditorController` + the Save/Publish lifecycle unchanged.
- **Editor host** (`edit/index.html`): read `?design` + `?org`; `get` the
  artifact (it carries `componentPath`), mount the editor with the design store.
  No separate metadata fetch. If no artifact yet (fresh/forked-from-template),
  boot from the component template.
- **Fork redirect**: `/ops/` already returns `{ fork_design_id, workspace_org_id }`
  — change the redirect to `/edit/?design=<id>&org=<workspaceOrg>`. It now opens,
  because the platform owner is a member of the workspace org, so the org-scoped
  design routes authorize normally (no admin route needed to *edit* a fork).

**Verify** (`scripts/verify-design-mode.mjs`, Playwright + stubbed Worker design
routes): `/edit/?design=&org=` mounts, loads the artifact, Save writes the draft
and Publish writes the served artifact through the design store; a fork opens and
round-trips.

## Phase 2 — Create-design UI + design-cap modal

Make the design boundary reachable and designs usable.

- **Dashboard "My designs" card**: `GET /api/orgs/<org>/designs` → list (name,
  live/draft status) with **Open** (→ `/edit/?design=<id>&org=<org>`) and **New
  design**.
- **New design**: `POST /api/orgs/<org>/designs` → on `201` open the new design in
  the editor; on **`409 design_limit_reached`** call `showUpgradeModal(org, …)`
  (the shared modal). This is the third boundary.

**Verify** (`scripts/verify-designs-ui.mjs`): the list renders, New design opens
the editor, and the 4th free design → upgrade modal.

## Phase 3 — Boundary completeness

- **Mid-session time limit**: the Worker returns `402` (with `billing`) on
  publish when a trial has expired mid-session. Catch it in the editor's publish
  path and call `showUpgradeModal(organization, 'Your free trial has ended.')`
  instead of a raw error — complementing the load-time read-only modal.
- Confirm all three boundaries (site, design, time) route to the one shared modal.

**Verify**: extend the editor verify to assert a `402` publish surfaces the modal.

## Phase 3b — Tier `deploy-check` on the publish paths

Wire the Worker to core's `deploy-check` (see `core/PLAN_TIER_AND_ENV.md`) on
every path that writes a **served** artifact. No funnel redesign is needed — the
confirmation handler already creates the account + org and *then* promotes, so it
is already an org-owned publish; it just needs the check.

- **Extract the declared manifest** from the canonical artifact (top-level
  `config.componentPath` + each `content.components[].componentPath`), and call
  `POST /v1/organizations/{id}/deploy-check` (internal key) with a bounded
  manifest before any served write. **Preserve a `402` body** back to the client
  (never turn it into 503) so the upgrade/register modal shows.
- **Paths:** (1) direct site publish — first assert URL path ==
  site-metadata path == `artifact.config.componentPath`; (2) **confirmation
  promotion** — check with the returned org id **before starting the trial and
  before `promoteSite`**; on denial, keep the account+org, **retain the staged
  draft**, and return a result that directs the user to billing (no served write,
  no trial); (3) design **publish** (Phase 1's `POST …/publish`); (4) embed PUT —
  re-run the check against the associated published artifact's manifest (or write
  embeds only inside the orchestrated design publish).
- **Verify**: a page declaring `payments/*` is blocked at publish
  (`component_requires_paid` → modal); confirmation denial creates the org but
  publishes nothing and points to billing.

## Phase 4 — Live end-to-end

Everything above is tested against stubs. Run the real stack once and reconcile
any drift.

- **Runbook + smoke** (`scripts/verify-ops-e2e.md` + optional script) against
  migrated core + bootstrapped workspace + granted owner + wrangler:
  1. `/ops/` change an org's free-plan terms → that org's `/dashboard/` reflects
     it on refresh.
  2. Fork a design in `/ops/` → land in `/edit/?design=…` → edit → Save/Publish.
  3. Hit each cap (site, design) and the time limit → the upgrade modal.
- Reconcile any response-shape mismatches surfaced (as with the earlier
  `organizations`/`designs` envelope + fork-field reconciliation).

## Testing & sequencing

- Each phase adds/updates a `verify-*.mjs` (unit + Playwright as fitting), added
  to `verify-all.mjs`; `npm run build` green; existing worker/ops tests
  unregressed.
- Order: **1 → 2 → 3 → 4**. Phase 1 is the unlock (forks become editable); Phase 2
  completes the boundary story; Phase 4 is the real-stack gate.

## Dependencies
- No new core endpoints (design routes exist). Two *optional* core niceties are in
  `core/PLAN_FINISH.md` (admin org search-by-email; a single-design admin GET) —
  neither blocks this plan.
