# Editor plan: ops tabs, path routing, deletes, publish-modal fix

Companion doc: `core/PLAN_OPS_ACCOUNTS_AND_DELETE.md` (endpoints, guards, audit).
Do not implement until Igor says go. Igor deploys (`npm run deploy` here, push
for core); Claude never pushes or deploys.

## 1. Path routing in /ops/ (today: SPA innerHTML swaps, URL never changes)

Igor's decision: real paths keyed by a unique id, not query params.

Routes:
- `/ops/` → organizations list (default tab)
- `/ops/orgs/<organizationID>` → org detail
- `/ops/accounts` → accounts tab
- `/ops/plan` → default free plan

Two halves:
- **Worker** (`site-worker.js`): `run_worker_first = true`, so add a rewrite
  before the asset fallthrough — `GET /ops/<anything>` serves the `/ops/`
  index asset (same pattern as the legacy-dashboard rewrite at line ~129).
  Without this, deep links and reloads on `/ops/orgs/<id>` 404.
- **Page** (`ops/index.html`): render from `location.pathname` on load,
  `history.pushState` on tab/row clicks, `popstate` restores the view — back
  button must return detail → list instead of leaving the console.

## 2. Accounts tab (new ask)

Nav becomes three tabs: **Organizations | Accounts | Default plan**.
Accounts tab: search box (email substring) + rows of email, created date,
`membership_count` (labeled as memberships — it is *not* what deletion would
remove), staff badge. Data from `GET /api/ops/accounts` → worker-forwarded to
core's new `GET /v1/admin/accounts`, paginated with `q`/`limit`/`cursor` and
`next_cursor` exactly like the org list.

## 3. Deletes (orgs and accounts)

Purpose: cleaning up Igor's plus-alias test accounts (`test22+igor.…@gmail.com`).

- **Org detail** gets the slug **displayed** (Igor's requirement — it is the
  typed confirmation phrase) and a Delete button. Confirm modal: type the exact
  slug to enable the button. On success navigate back to `/ops/`.
- **Account rows** get Delete. The confirm modal first fetches the deletion
  preview (`GET /api/ops/accounts/<id>` → core's account detail) and shows what
  will happen: orgs that cascade (`sole_member`), orgs that will **block**
  (`last_owner`), and remaining memberships that simply detach. Then type the
  exact email to enable the button. Staff accounts render no delete control
  (core 409s them anyway).
- Show core's 409 reasons verbatim (`subscription_active`, `platform_workspace`,
  `staff_account`, `last_owner` — see core doc); the message already names the
  blocking org's slug, so no generic "could not delete".

**Worker orchestration** (core owns rows, Worker owns R2 — same split as fork):
- `DELETE /api/ops/organizations/<id>`: call core first (it authenticates and
  guards); on 200, purge R2 prefixes `orgs/<id>/` and `sites/<sub>/` for each
  entry in the response's `released_sites`, using `listAllObjects` + delete.
- `DELETE /api/ops/accounts/<id>`: same; purge `orgs/<oid>/` for every id in
  `deleted_organization_ids` plus all `released_sites`.
- These are orchestrated handlers like `handleOpsFork`, not `opsForwardAllowed`
  entries; `GET accounts` and `GET accounts/<id>` are plain allowlist additions.

**Cleanup — reconciliation, not receipts. Orphaned blobs are NOT harmless.**
Published sites serve straight from R2 (`sites/<sub>/…`), so if core deletes
the rows but the purge fails (or the response is lost after commit), the
deleted org's site **keeps serving publicly**, and retrying the DELETE just
404s. Earlier revisions solved this with cleanup receipts, but a receipt
written before the delete is unavoidably **stale** — sites and orgs can change
between preview and DELETE — and a receipt written after can be lost. So no
receipts. Instead, R2 itself is the durable record and core is the truth:

- **Immediate purge** acts only on core's DELETE **response**
  (`released_sites`, `deleted_organization_ids`) — computed under the delete
  transaction's locks, so it is exact: a site added concurrently is blocked by
  the org row lock and either lands in the response or in a surviving org.
  Never purge from preview data. For each released site, read its `meta.json`
  first and delete the site prefix plus the **sidecars**, exactly like the
  existing release path (site-worker.js:1580–1592):
  `embed-identities/<publishableKey>/<siteId>.json` and
  `moderation/flags/<sub>.json`. Purge failure → log and return 200 with
  `"purge": "pending"` (rows are authoritative; UI shows "cleanup queued").
- **Nightly reconciliation** in the existing cron (`scheduled` →
  `cleanupExpiredSites`, which already lists every `sites/*/meta.json` daily):
  - meta **with** `organizationId` → ask core's machine-authenticated
    `GET /v1/organizations/<id>/exists` (new; see core doc — the entitlement
    endpoint is ambiguous when billing is absent); org gone → release the site
    (ordered purge below);
  - meta **without** `organizationId` — this state is real, not an anomaly:
    the claim flow writes meta first and binds core second
    (site-worker.js:738–758), so a crash between them strands a bound site
    with unassociated meta, and today's cron just skips it. Ask core's
    `GET /v1/sites/<subdomain>/binding` (new): bound → **backfill**
    `organizationId` into the meta, self-healing the crash window so the
    normal path covers it from then on. Unbound → release **only on positive
    identification of an abandoned modern claim** — an unbound meta is not
    proof of abandonment, because `serveSite` supports **legacy published
    sites** (missing status/ownership fields, site-worker.js:1710) that have
    no core binding and must be preserved. Release requires ALL of:
    1. binding lookup says `bound: false`;
    2. the site is positively abandoned: `status === 'drafted'` (an anonymous
       funnel draft — serves nothing), **or** it has zero published content
       under the `publishedComponentCount` predicate (site-worker.js:1329:
       `.json` objects excluding `meta.json`, `assets/`, `draft/`) — a crashed
       modern claim dies before any deploy, so it always has zero, while a
       legacy published site by definition has at least one;
    3. `createdAt` present **and** older than the email-confirmation TTL plus
       a day of slack — legacy metas predate `createdAt`, so a missing
       timestamp reads as "legacy, keep", never "old, delete".
    Anything unbound that fails a condition is left untouched — legacy
    published sites are preserved indefinitely (their retirement is explicitly
    out of scope here);
  - list `orgs/<id>/` top-level prefixes the same way; org gone → purge.
  This converges every failure mode — failed purge, response lost after
  commit, worker crash mid-purge, crash mid-claim — within a day, and by
  construction can never touch a live org's blobs: the sweep purges only what
  core confirms deleted or unbound, comparing *current* R2 state rather than a
  snapshot, so there is nothing to go stale.

**Purge order — meta.json strictly last.** Two reasons, both verified:
`serveSite` treats a site with **missing meta as a legacy published site**
(site-worker.js:1710) and will serve leftover artifacts with no core check;
and the sweep discovers orphans *through* meta, so deleting meta first makes a
partial purge invisible to the very mechanism meant to finish it. The existing
release loop deletes in list order and guarantees neither property, so "reuse
the release path" is insufficient — extract a shared `releaseSiteObjects`
helper used by the immediate purge, the sweep, and the existing expiry path:
1. read and retain `meta.json`;
2. delete every `sites/<sub>/…` object **except** `meta.json`;
3. delete the embed-identity and moderation-flag sidecars (keys from the
   retained meta);
4. delete `meta.json` last.
A crash at any step leaves the orphan discoverable (meta still present) and
un-servable (no artifacts left by the time meta could go).

## 4. Publish-modal fix (the "email already taken" confusion)

Findings: nothing ever checks whether an email is taken. The red message was
`edit/funnel-ui.js:138` — `"That name is taken (or the email already has a
site)."` — which fires on 409 only when the **site name** is already claimed in
R2 (`site-worker.js` `/api/deploys`, `ARTIFACTS.head(sites/<site>/meta.json)`).
The parenthetical is wrong/misleading copy. The later "confirmation sent" modal
was a second successful submit (button is never disabled in flight, so
double-clicks race; two listeners fire two fetches).

Fix:
- Copy → `"That site name is already claimed — pick another."` (no email
  mention) in `showDeployModal`.
- Disable the submit button while the request is in flight in **both**
  `showDeployModal` and `showRegisterModal`; re-enable on error.
- Plus-alias emails: worker regex and core `mail.ParseAddress` both already
  accept `+`, and each alias is a distinct account. Add a Playwright/worker
  assertion using a `+` email so a future "normalization" change can't silently
  break Igor's test flow. Never normalize aliases away.

## Verification

- `verify-ops-fork.mjs` (worker unit): delete orchestration cases — staff org
  delete 200 → R2 keys under `orgs/<id>/`, released `sites/<sub>/`, and the
  embed-identity + moderation-flag sidecars gone; purge acts **only on the
  response** (a site present in R2 but absent from `released_sites` — i.e.
  belonging to a surviving org — is untouched); purge failure (MemoryBucket
  fail hook on delete) → response says `"purge": "pending"`, blobs remain;
  reconciliation sweep with core answering `exists: true` → blobs untouched;
  `exists: false` → site prefix + sidecars + org prefix purged (this is also
  the recovery test for a response lost after core committed); sweep on meta
  **without** `organizationId`: bound → meta backfilled, nothing deleted;
  unbound abandoned claim (tokenHash meta, zero published content, old
  `createdAt`) → released; unbound abandoned draft (`status: 'drafted'`, old)
  → released; unbound + young → untouched; **legacy published site preserved**:
  meta with no `organizationId`, no `status`, no `createdAt`, a published
  artifact present, core binding absent → sweep touches nothing (the
  reviewer-required test); same-shape meta *with* `createdAt` and published
  content → also untouched (published content alone vetoes release);
  **partial-purge
  order**: fail the purge partway (fail hook) and assert `meta.json` still
  exists while artifacts are gone — the orphan stays discoverable and nothing
  is servable — then a second sweep completes it; core 409s pass through
  verbatim; non-staff 403 → R2 untouched; account delete purges every org id
  and site in the response.
- `verify-ops-panel.mjs` (browser): URL changes on org click
  (`/ops/orgs/<id>`), back button returns to the list, tabs route, slug is
  visible on detail, delete button stays disabled until the exact slug/email is
  typed, `+`-alias email accepted in the register modal.
- Known-red suites unrelated to this work: toolbar Save+Publish selector,
  full-stack timeouts (see memory note; don't chase them here).
