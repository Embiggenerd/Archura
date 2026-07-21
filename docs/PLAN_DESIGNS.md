# Phase 3 Sub-Plan — Designs as First-Class Artifacts

**Status: sub-plan of `PLAN_ONBOARDING_BILLING.md` (Phase 3). Not built.**
Reworks the editor's persistence model so a *design* exists independently of a
subdomain. This is the keystone the usage caps and the onboarding funnel sit on.

## The problem in the current model

Everything is **slug-keyed**: `mountEditor(site)`, the adapter endpoint
`/api/artifacts/<site>`, every R2 key `sites/<slug>/…`, serving, and embeds.
There is no artifact that isn't a deployed site. A design (a saved, embeddable
component not yet on a subdomain) has no home and no key.

## Design identity vs. address (aligns with the doctrine)

The fix reuses the identity-vs-address doctrine (`AUTH_ARCHITECTURE.md`):

- **A design is the identity-bearing artifact.** It gets a permanent
  `designId` (`dsn_…`), org-scoped, minted at creation. It is autosaved and
  embeddable regardless of deployment.
- **Deploying adds an *address*** — a subdomain that maps to the `designId`.
  Serving resolves `host → designId → design storage`. A design can have zero
  or one subdomain (later, many); the subdomain is renamable/releasable, the
  designId is not.
- This makes "edit → live" correct by construction: autosave writes the single
  source (the design); a deployed design's subdomain serves that same source,
  so edits are live without re-deploying.

## Storage (R2)

```
orgs/<orgId>/designs/<designId>/
  artifact.json              # the canonical design (autosaved)
  meta.json                  # { designId, orgId, name, createdAt, subdomain? , publishableKey }
  embed/<Component>.js       # generated embed modules (as today, per design)
addresses/<subdomain>.json   # { designId, orgId } — the host→design map (deploy)
```

Existing `sites/<slug>/…` becomes a legacy alias during migration (serving
falls back to it); new work writes the design namespace.

## Sub-phases (each independently verifiable)

### 3a — Design storage + autosave + "My designs" (no deploy change yet)

- **Worker:** `POST /api/designs` (create → `dsn_`), `GET/PUT
  /api/designs/<id>/artifact`, `GET /api/designs/<id>/embed/<name>`,
  `GET /api/orgs/<org>/designs` (list) — all org-session authed, stored under
  `orgs/<org>/designs/`. Purely additive; existing site routes untouched.
- **Adapter:** a design-mode `createDesignAdapter({ designId })` (load/publish/
  publishEmbed against the design namespace), sibling to `createR2Adapter`.
- **Controller:** add **autosave** — persist the artifact on change (debounced),
  not just on explicit publish. (Today `onChange` notifies but does not persist.)
- **Editor:** `/edit/?design=<id>` mounts a design; "New design" mints one.
- **Dashboard:** a "My designs" card — list org designs, open, new. Separate
  from the deployed-sites list.
- *Verify:* create → autosave → reopen shows saved content; list returns it;
  existing funnel/deploy suites stay green (additive).

### 3b — Deploy = map a subdomain to a design

- **Worker:** deploying a design writes `addresses/<subdomain>.json →
  {designId}` and the design's `meta.subdomain`. `serveSite` resolves
  `subdomain → addresses/<sub>.json → designId → orgs/<org>/designs/<id>/`,
  falling back to the legacy `sites/<slug>/` path for pre-migration sites.
  Embeds already resolve by pk+siteId; point siteId at the designId.
- The funnel's anonymous deploy still works: an anonymous draft becomes a
  design at confirm, then gets a subdomain.
- *Verify:* deploy a design → its subdomain serves the design; editing the
  design (autosave) updates the live subdomain without re-deploy.

### 3c — Counts + caps (folds in Phase 2)

- **Worker (trusted server) is the enforcement point:** count
  `orgs/<org>/designs/*` (designs) and the org's addresses (deploys); check
  against the plan limits from the entitlement (free 1 deploy/3 designs; Basic
  3/10) before create-design and deploy; return a 402 the editor renders as the
  **non-blocking upgrade modal**. (Deploy count can also cross-check core's
  `organization_sites`; core may mirror the design count later if it must be
  tamper-proof — designs are edge artifacts, so Worker-side counting is
  consistent with edge-first.)
- *Verify:* 4th design / 2nd deploy on free → modal; after subscribing (Basic)
  the limits rise to 10/3.

## Decisions (made; flag if wrong)

- **Design = identity, subdomain = address** (reference model, not
  copy-on-deploy) — single source, edits-go-live, doctrine-consistent. The
  cost is reworking `serveSite`/embeds to resolve through the design; worth it
  vs. the stale-copy problem.
- **designId format `dsn_…`**, org-scoped, permanent, never reused.
- **Autosave** replaces manual save for designs; explicit **Deploy** is the
  only publish-to-subdomain action.
- **Counts enforced Worker-side** (edge-first), deploys cross-checked against
  core; core-mirrored design counts deferred.

## Migration / back-compat

- Existing `sites/<slug>/` sites keep serving via the legacy fallback in
  `serveSite`; no data migration required to ship 3a/3b. A later pass can
  convert them to designs + addresses.
- The verify suites assume slug-keyed sites; they stay green because the legacy
  path is preserved. New design-mode suites are added per sub-phase.

## Out of scope

- Multi-subdomain-per-design, design versioning/history, design templates.
- Core-authoritative design counts (Worker-side is enough for the prototype).
