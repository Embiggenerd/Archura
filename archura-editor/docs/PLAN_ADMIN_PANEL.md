# Plan — Platform Owner: Inspect, Fork & Free Plan (archura-editor)

The platform-owner surface: browse any organization read-only, **fork** a design
into the platform workspace to edit (by hand or agents), and edit **free-plan
terms** — the default plan new orgs get, and any individual org's terms.

**Contract:** `core/PLAN_ADMIN_CONSOLE.md` (authoritative for `/v1/admin/*`).
**Principles:** never write customer *content* — fork it; free-plan *terms* are
our settings, edited in place with **no inheritance** (a new org is seeded with
the default plan and then owns its values). Editing a fork is the normal editor,
so this is a thin **read + fork + terms-edit** surface.

---

## 1. Goal

A signed-in platform owner (staff) can:
1. Browse/search any org and its designs, **read-only** (no membership needed).
2. **Fork** a design → copied into the workspace org → land in the existing
   editor on the fork. The customer's design is never touched.
3. Edit **free-plan terms** — the default plan (seeds new orgs) and a specific
   org's terms (trial end / no-expiry, designs allowed, subdomains allowed).
   Changes show on the client's next refresh; nothing is permanent.

## 2. Trust boundary

- **Page:** staff-only `/ops/` (static HTML + inline JS, `dashboard/index.html`
  style).
- **BFF + fork orchestration:** new Worker routes `/api/ops/*` in
  `workers/site-worker.js`. The Worker owns R2 (performs the fork copy and
  enriches design reads with R2 presence); Core owns rows, terms, and audit.
- **Hard rule:** only staff sessions reach `/api/ops/*`; the browser never holds
  service/internal keys.

## 3. Access (fail-closed)

- Reuse the existing account session; `/api/ops/*` forwards to Core, which
  enforces the `401 / 403(non-staff) / 403(!platform_owner)` matrix. Don't render
  `/ops/` chrome for non-staff.
- Admin is **disabled by default in production** in Core (`ADMIN_API_ENABLED`);
  the Worker additionally does not mount `/ops/` or `/api/ops/*` in a production
  build until that flag + MFA land. This is a fail-closed control, not a note.

## 4. Fork orchestration (idempotent, finalized)

`POST /api/ops/forks { source_design_id }`, staff-gated. The Worker:
1. Generates an `idempotency_key`; calls Core `POST /v1/admin/forks
   {source_design_id, idempotency_key}` → `{ fork_design_id, workspace_org_id,
   source_org_id, status: "pending" }` (retry returns the same fork).
2. **Reads** the source artifact from R2 — **published**, else **draft**, else
   none (fork starts from the component **template**) — recording which kind and,
   for published/draft, its **ETag/hash** (template forks have no ETag).
3. **Writes** it into the workspace namespace (`orgs/<workspace_org_id>/designs/
   <fork_design_id>/artifact`).
4. Calls Core `POST /v1/admin/forks/{id}/finalize { status: "ready"|"failed",
   source_artifact_kind: "published"|"draft"|"template", source_etag?,
   template_ref? }`. Finalize is idempotent; a retry re-copies and re-finalizes
   (`pending`/`failed` → `ready`) — the Worker is the only writer, so this is
   sequential, never concurrent.
5. On success, returns `{ fork_design_id, workspace_org_id }` → redirect into the
   editor. On copy failure, finalizes `failed` and surfaces an error (no
   half-created fork is presented as usable).

Customer blobs are only read; the sole write is into the workspace namespace.
**What's copied (v1):** only the one canonical artifact above — embed modules
regenerate at publish (the editor's normal flow), and uploaded assets are **not**
copied; the fork retains references to the source's asset URLs.

## 5. R2 enrichment for reads

Core's `GET /designs/{id}` returns the **record only**. The Worker's
`GET /api/ops/designs/:id` enriches it with **R2 artifact presence**
(draft/published) from its bucket binding, since Core can't see R2. Same pattern
for the per-org designs list (lifecycle/status shown in browse).

## 6. Free-plan terms editing (no inheritance)

Two surfaces, no publish step (Core computes caps per request → live on refresh):
- **Per-org, on the org record:** a **Free-plan terms** panel — trial length /
  end, designs allowed, subdomains allowed. These are the org's own values
  (seeded from the default at signup); the panel shows each and edits it via
  `PATCH /api/ops/organizations/:id/free-plan` with a required **reason**. The
  trial control is stage-aware: **before the trial starts** it edits
  `free_trial_days`; **after it starts** it edits `trial_ends_at`, plus a **"No
  expiry (forever)"** toggle either way. No "inherited vs set" — each org just has
  its values.
- **Default plan screen** (what *new* orgs get): edit `trial_days`,
  `free_design_limit`, `free_site_limit`, `free_no_expiry` via
  `/api/ops/default-plan`. A note makes clear this affects **future** orgs only,
  not existing ones.

Client-facing errors surfaced: `422` (out-of-range) inline on the field.

## 7. UI

Reuse the mock's tokens/classes (`docs/PLATFORM_OWNER_ADMIN_PANEL.html`):
- **Browse:** global search + org list; an org shows its designs read-only (name,
  component_path, live/draft from §5) with a **Fork** button each, plus the
  **Free-plan terms** panel (§6). Inspection + terms only — no edit control over
  customer content.
- **After Fork:** redirect to the existing editor (`/edit/?design=<fork_design_id>`);
  normal editor + draft/publish thereafter — **no new editor code**.
- **Forks** view (`GET /api/ops/forks`, `ready` only) to resume prior work.
- **Default plan** screen (§6).

## 8. Worker BFF routes (`/api/ops/*`)

Gate-then-forward (mirror the core-proxy pattern + its verify test); pass Core
status/body through unchanged, except fork (§4) and design reads (§5) which the
Worker orchestrates/enriches:
- `GET  /api/ops/organizations?q=&cursor=&limit=` · `GET /api/ops/organizations/:id`
- `GET  /api/ops/designs/:id` (enriched)
- `GET  /api/ops/forks?state=&cursor=&limit=` · `POST /api/ops/forks`
  (orchestration); plus the paginated `GET /api/ops/organizations/:id/designs` and
  `.../members` proxies for large collections
- `GET  /api/ops/default-plan` · `PATCH /api/ops/default-plan`
- `PATCH /api/ops/organizations/:id/free-plan`

## 9. Testing

Follow the `scripts/verify-*.mjs` pattern (node unit + Playwright):
- **BFF / R2 unit** (`scripts/verify-ops-fork.mjs`, MemoryBucket + stubbed Core)
  — the R2 side Core can't test: `/api/ops/*` needs a staff session (non-staff →
  `401/403`); `POST /api/ops/forks` creates→copies→finalizes, **leaves the source
  blob byte-for-byte unchanged**, writes to the **correct workspace destination
  key**, and supplies the **correct ETag** (and `source_artifact_kind`) to
  finalize; a retried key doesn't duplicate; a copy failure finalizes `failed` and
  surfaces an error; `GET /designs/:id` is enriched with R2 presence.
- **End-to-end** (`scripts/verify-ops-panel.mjs` or a dedicated pass):
  `create → copy → finalize → ready` against a stubbed Core, landing in the editor
  on the fork.
- **Panel browser verify** (`scripts/verify-ops-panel.mjs`): staff browse an
  org's designs read-only; Fork redirects into the editor on a `ready` fork; no
  write control over customer content; the free-plan panel PATCHes with a reason;
  the default-plan screen round-trips and is labeled "new orgs only".
- **Build green** (`npm run build`); existing worker unit tests unregressed.

## 10. Phasing (tracks Core)

0. Wait on Core's contract-first schemas (§9 of the Core plan) or stub them.
1. **Browse** — `/ops/` shell, access gate, org/design reads (+ R2 enrichment).
2. **Fork** — orchestration (idempotency + finalize) + redirect + Forks list.
3. **Free plan** — per-org terms panel + default-plan screen. (Independent.)

## 11. Dependencies

- Blocks on Core `/v1/admin/*` per `core/PLAN_ADMIN_CONSOLE.md`; a stubbed Core
  unblocks UI work meanwhile.
- Reuses: the designs store (`get`/`put` + ETag), the existing editor + draft/
  publish lifecycle, the dashboard-style page, and the Worker core-proxy pattern
  with its verify tests.
- `staff_role`, `ADMIN_API_ENABLED`, the cap-exempt workspace org, fork
  state/provenance, the default plan, and per-org terms all come from Core; this
  side reads customer data, writes fork blobs, enriches with R2 presence, and
  proxies term edits.
