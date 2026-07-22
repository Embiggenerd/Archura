# Plan — Component tier gating + environment signal (core)

Two additions the editor depends on. A different model executes this. Core owns
the registry, billing, and `deploy-check`; the Worker owns R2 and calls it.

**Product rule.** Free users create and deploy **full pages** (with frontend
components nested inside). Creating a **standalone component**, or using a
**backend** component (`payments/*`), requires Basic. Client gating is bypassable,
so core enforces.

**No anonymous publishing — and the existing flow already honors it.** The
confirmation handler already: `VerifyConfirmation` (core creates account + org +
session) → start trial → promote the staged artifact. That is an **org-owned**
publish, so no funnel redesign is needed — it just has to be one of the checked
publish paths (§1e).

---

## Part 1 — Component tier gating

Five parts, designed so we never do HTML forensics:

1. **Component registry (authoritative, ours).** Each known component →
   `{ kind: page|component, capability: frontend|backend }`. Source of truth in
   core. `payments/*` is `backend`; pages/heroes/cards/images are `frontend`.
2. **Paid access from RAW billing** (never `entitlement.status`, which flattens
   cases):
   ```
   hasPaidComponentAccess(billing) :=
        caps_exempt
     OR stripe_subscription_status ∈ {"active","trialing"}
     OR (stripe_subscription_status == "canceled" AND now < current_period_end)
   ```
   `free_no_expiry` and the no-card trial are **free-tier** for components.
3. **Manifest, not HTML.** The artifact **declares** the components it uses — the
   top-level `config.componentPath` plus the instance paths in
   `content.components`. The Worker extracts that declared manifest and sends it.
   **We do not scan the HTML to prove it matches the manifest.** (We can't detect
   a component *omitted* from the manifest — that's fine; see #5.)
4. **Validate every declared path against the registry.** Unknown or malformed →
   **fail closed** (deny). Known → classify and apply the rule.
5. **Backend capability enforced independently.** `/v1/components` and
   `/v1/component-sessions` require paid access **regardless of any artifact**.
   This is the real, unbypassable gate: a client that omits/lies in its manifest
   gains nothing, because a payment component is inert without the paid backend.
   This is *why* #3 can trust the declared manifest instead of parsing HTML.

### Tier rule (given `hasPaidComponentAccess`)
- Top-level `page` → free; denied only if a **declared nested** component is
  `backend`.
- Top-level standalone `component` → requires Basic.
- Nested `frontend` → free; nested `backend` → requires Basic.
- Unknown top-level or declared nested path → deny.

### Creation vs publication (decisions)
- **Standalone/backend creation is gated.** `CreateDesign` with a `component`-kind
  path → require Basic; page-design creation → free. **Reject an
  explicitly-supplied invalid `component_path`** rather than coercing it to
  `pages/Landing` (coerce only when the field is *absent*).
- **Design draft vs publish — a real boundary** with explicit Worker route
  contracts (implemented editor-side; defined here as the boundary `deploy-check`
  hooks into):
  - `PUT /api/orgs/<org>/designs/<id>/artifact/draft` — save draft; **no tier
    check**.
  - `POST /api/orgs/<org>/designs/<id>/publish` — load the draft, run
    `deploy-check` on its declared manifest; on allow, promote it to
    `artifact.json` **and write its generated embed modules in the same
    operation**, then delete the draft.
  - `GET /api/orgs/<org>/designs/<id>/artifact` — return the draft if present,
    else the published artifact (editor restoration).
  - Public / embed serving reads **only** `artifact.json`.

### `deploy-check` contract (internal)
`POST /v1/organizations/{id}/deploy-check`:
- **Auth:** the Worker's internal bearer (`CORE_INTERNAL_KEY`); reject any
  customer/session caller.
- **Org id:** taken from the URL; the **Worker derives it from trusted
  site/design metadata** and never from a client-supplied field. (An internal
  credential may legitimately inspect any org, so there is no per-request
  ownership check here — trust is established by the Worker.)
- **Body:** `{ "top_level": "<path>", "uses": ["<path>", …] }` — bounded (cap
  `uses` length and each path length) and validated; malformed → `422`.
- **Response:** allowed → `200 { "allowed": true }`; denied → `402` with the
  standard envelope `{ "error": { "code": "component_requires_paid", "message":
  "This component needs the Basic plan." } }`. Exactly one shape per outcome; the
  Worker **preserves the 402 body** (never 503).

### 1e. Publish paths that run the check
All are org-owned; each calls `deploy-check` with the declared manifest before any
**served** write:
1. **Direct site artifact publish** — first require **equality** of the URL path,
   the trusted site-metadata component path, and `artifact.config.componentPath`
   (reject mismatch); then `deploy-check`.
2. **Design publish** (`POST …/publish`) — check the draft's manifest; draft saves
   (`…/artifact/draft`) are **not** checked.
3. **Confirmation promotion** — call `deploy-check` with the **returned org id**
   **before starting the trial and before `promoteSite`**.
4. **Embed writes** — artifact and embed uploads are separate requests, so tie
   embeds to approval concretely: **before accepting an embed PUT, load the
   associated published artifact and rerun `deploy-check` against its declared
   manifest** (or write embeds only inside the orchestrated design publish above).
   **No persistent "approved" flag** (stale risk).

### 1f. Denial side-effects (corrected)
Anonymous `/api/deploys` writes **draft** objects to R2 *before* confirmation, so
`deploy-check` cannot precede all R2 writes. Guarantee: **a denied `deploy-check`
does not start a trial and does not write or promote any served artifact.**
On denial at confirmation: the account + org are still created and the user is
signed in; **the staged draft is retained** and the confirmation result **directs
the user to billing** ("your site is ready — start Basic to publish"). **Cleanup
policy:** an unpublished staged draft expires after a TTL (e.g. 7 days), releasing
the site name.

### 1g. Backend capability (independent)
`/v1/components` config + `/v1/component-sessions` creation → require
`hasPaidComponentAccess` for the owning org; else `402 component_requires_paid`.

## Part 2 — Environment signal (dev | prod only)

`ARCHURA_ENV` supports only `dev` | `prod` today (it gates key prefixes, prod
config, rate limits, origin/edge auth), so **staging is out of scope** — the badge
shows **Dev** or **Production** only.

- `GET /v1/admin/context` → `{ "env": <ARCHURA_ENV> }`, staff-gated like the rest
  of `/v1/admin/*`. The Worker forwards it under `/api/ops/*`; the ops page reads
  it and labels the badge, replacing the hostname heuristic.

## Part 3 — Deliverables

- **Core:** the registry + `classify`; `hasPaidComponentAccess`; the `deploy-check`
  endpoint; billing checks on `/v1/components` + `/v1/component-sessions`; the
  `CreateDesign` gate + reject-invalid-path; `GET /v1/admin/context`; **OpenAPI**
  for the new endpoints; Core tests (Part 4).
- **Worker/editor (cross-ref `archura-editor/docs/PLAN_FINISH.md`):** the design
  draft/publish/get routes (§draft-vs-publish); `deploy-check` calls on the four
  publish paths incl. **confirmation promotion**; the embed re-check; **`/api/ops`
  forwarding** of `/v1/admin/context`; the **ops badge** reading env; Worker
  integration tests.

## Part 4 — Tests

- **Tier:** free page declaring `cards/*`+`heroes/*` → allowed; free page declaring
  `payments/*` → `402`; standalone `component` (free) → `402`; **top-level page** →
  allowed.
- **Registry/fail-closed:** a **missing top-level path** and **malformed declared
  entries** → deny/reject. (We do *not* test "omitted nested path denies" — under
  manifest trust core can't detect an omission; the backend gate covers it.)
  An explicit invalid `component_path` to `CreateDesign` → rejected, not coerced.
- **Raw billing:** `free_no_expiry` and no-card-trial → free-tier (denied);
  `canceled`-within-period → paid; `caps_exempt`/workspace → allowed. Not from
  `entitlement.status`.
- **Draft/publish:** a draft save is ungated; publish runs the check.
- **Backend (the real gate):** `/v1/components` + `/v1/component-sessions` enforce
  paid access — a free org is `402` even with no `payments/*` in any manifest (a
  disguised payment page is therefore inert).
- **Denial side-effects:** a denied `deploy-check` does not start a trial and does
  not write/promote a served artifact (drafts may already exist); confirmation
  denial retains the staged draft and directs to billing.
- **`deploy-check` auth:** requires the internal key; rejects session/customer
  callers. The **Worker derives the org id from trusted metadata and ignores any
  client-supplied id**.
- **Site path integrity:** URL path == site-metadata path == `artifact.config.
  componentPath`.
- **Env:** `GET /v1/admin/context` returns the configured `ARCHURA_ENV`;
  staff-gated.

## Sequencing
Smallest independent wins first: **1g** (backend-API billing checks — the
unbypassable capability gate) and the **creation gate + reject-invalid-path**;
then the **draft/publish routes** + `deploy-check` on the four publish paths
(including confirmation promotion); then Part 2.
