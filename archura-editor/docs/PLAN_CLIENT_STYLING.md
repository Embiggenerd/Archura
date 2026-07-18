# Editor Plan — Per-Client Component Styling (edge-first)

Work order for `archura-editor` (editor package + `workers/site-worker.js`). Identity
model: "Namespaces & the tenant → namespace binding" in `docs/AUTH_ARCHITECTURE.md`.
Core has exactly one small companion item (store the binding) — see
`core/PLAN_CLIENT_STYLING.md`.

**Design decision (supersedes the earlier core-fetch draft):** styling lives at the
edge, not in the core. An embedded component is a GET of a JS module; publishing
regenerates that module, so embeds update wherever they are pasted. Core stays the
identity authority — client data and the tenant → namespace binding — plus (later, M4)
tamper-proof payment config.

## Goal

Change a component's styling in the editor **under a test client identity**, publish,
and see every embed of that client's component render the new styling — while a second
client's identical component keeps its own styling. The client's components are
enumerable in their namespace regardless of persistence adapter.

## Model

- **Client = core tenant + bound edge namespace.** `sites/<slug>/` is the namespace;
  the claim token is its publish credential; core stores the binding (slug + token) so
  it knows who owns what and admins/devs can resolve every namespace. Registration is
  one flow: claim the namespace, create the tenant, store the binding.
- **One canonical path scheme across adapters.** R2: `sites/<slug>/<kind>/<name>`;
  filesystem adapter: `artifacts/sites/<slug>/<kind>/<name>` — same namespace layout,
  different root, no auth locally (a dev is implicitly admin). The dashboard and agents
  enumerate a namespace identically against either backend.
- **Shared component code stays shared and immutable** (`/components/...js`, built by
  `build-components.mjs`). What is per-client is a thin generated **embed module**:

  ```
  sites/<slug>/embed/<component>.js
  ```

  which imports the shared component module, injects the client's styling (a `<style>`
  tag of custom-prop rules scoped to the component tag), and stamps configured traits.
  The pasted snippet is one script tag + one element:

  ```html
  <script type="module" src="https://archura.ai/s/<slug>/embed/StripePayment.js"></script>
  <archura-stripe-payment></archura-stripe-payment>
  ```

- **Publish = overwrite that module.** Served with CORS and `no-store` (matching
  artifact serving), so an edit is live on every embedding page on its next load. The
  shared component code URL is the immutable one; the per-client embed module is the
  mutable one. Agents and staff edit through exactly the same editor (pixels or
  controller API) + claim token + publish path as the client.

## Work items (in order)

### 1. Canonical namespace paths + `list()` on adapters

- Unify the filesystem adapter onto the namespace layout
  (`artifacts/sites/<slug>/...`) so both adapters address `<namespace>/<kind>/<name>`.
- Extend `ArchuraPersistenceAdapter` with `list(namespace) → [{ path, kind, updatedAt }]`:
  filesystem adapter lists the directory via the dev-server artifact-store plugin; R2
  adapter calls a new Worker route `GET /api/sites/<slug>/list` (claim-token auth,
  `ARTIFACTS.list({ prefix })` — the one R2 primitive the Worker doesn't expose yet).

*Verify:* the same `list()` call returns the same shape for a namespace seeded
identically under each adapter; wrong/missing claim token → 401 on the Worker route.

### 2. Embed-module generation (editor package)

- Pure exported function `generateEmbedModule({ componentPath, tag, styling, traits, base })`
  → JS source string. Styling input is the custom-prop map the styling panel already
  produces (host + per-part props, e.g. `--button-background`); it becomes a scoped
  style rule injected by the module. Unit-testable with no editor running.
- Controller: on `publish()`, for each component instance in the artifact, derive the
  styling map + traits and produce the embed module alongside the existing artifact,
  written through the active adapter (same namespace, `embed` kind).

*Verify:* unit tests — generated source imports the right shared module URL, contains
the custom props, escapes values; snapshot test of one full module.

### 3. Publish + serve path (Worker)

- Extend the existing artifact PUT surface so the editor can PUT
  `sites/<slug>/embed/<name>.js` (claim-token auth, same `tokenHash` check as artifacts
  and assets — reuse, don't add a new auth path).
- Serve `GET /s/<slug>/embed/<name>.js` (and on subdomains `/embed/<name>.js`) from R2
  with `Content-Type: text/javascript`, `withCors()`, `Cache-Control: no-store`.

*Verify:* PUT without the claim token → 401; after PUT, the module is fetchable
cross-origin and executes on a foreign page.

### 4. Test-client registration (one flow) + "Get embed code"

- `scripts/register-test-client.mjs`: **claim** `sites/<slug>` via the Worker (existing
  IP-gated claim flow) → **create** the core tenant with the same slug via
  `POST /api/core/v1/clients` (admin key from `.env`), passing the claim token as
  `edge_claim_token` so core stores the binding → write slug + claim token to `.env`.
  One command yields a fully bound test client.
- A minimal "Get embed code" affordance (editor dev page or script output) printing the
  two-line snippet with the client's slug baked in.

*Verify:* two bound test clients; core has both bindings (never echoed back); snippets
differ only by slug.

### 5. End-to-end verify — the milestone gate

> Implementation notes (as built): adapter `list()` takes no argument — adapters are
> constructed bound to a site, so the namespace is implicit. Known editor gap found
> while verifying, out of scope here: restyling a **color** property after reloading a
> published artifact silently reverts in the GrapesJS color input (the restored value
> lives as inline style, which the style manager doesn't re-edit); live editor sessions
> restyle and re-publish correctly, which is what the suite exercises.

`scripts/verify-client-styling.mjs` (Playwright, house style, SKIPs if the Worker/dev
server is absent):

1. Register clients A and B (item 4); style the Stripe component red for A, blue for
   B, in the editor (or drive the controller programmatically — the agent path).
2. Publish both.
3. `list()` for A's namespace shows exactly A's components (and the same via the
   filesystem adapter locally).
4. Load a bare foreign-origin page embedding A's snippet → button computes red; B's →
   blue. **Per-client styling proven.**
5. Restyle A to green, re-publish, reload the same foreign page unchanged → green.
   **"Publish updates live embeds" proven.**
6. Wire into `verify-all.mjs`.

## Explicitly out of scope (prototype)

- View-time styling fetches from core; pk-authenticated reads.
- Staging/draft states, versioning, rollback, concurrency control.
- Accounts, passwords, dashboard sessions, credential release from core — auth stays
  claim token + admin key for now (passwords later, if we go that route, live only in
  core, hashed).
- Agent-specific credentials or roles — an agent edits exactly as we do, with the
  editor and the client's claim token.
- Payment config (price, mode) — core-owned for M4 precisely because clients must not
  be able to tamper with it. Styling has no such constraint.
