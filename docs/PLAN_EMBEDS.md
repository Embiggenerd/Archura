# Plan — pk-Addressed Embeds, Simplest Cut

(Previously "PLAN_EMBED_SNIPPETS" — renamed on the decision that **there are
no "snippets", only components of varying size**: a payment button is a small
component, a full page is a big one, and both ship the same way — a script
URL plus an element. "Embed code" is the copyable text; the thing embedded is
always a component.)

One goal, minimum moving parts: **`embed.archura.ai/<pk_>/<Component>.js`
serves the client's latest published module — for every component, page-sized
included — resolvable locally and in prod, with a toy client server to prove
embedding by hand.**

## What already exists (everything hard is done)

- Publishing already bakes the client's latest styling + traits into
  `sites/<slug>/embed/<Component>.js` for every **leaf** component instance,
  regenerated on every publish, served with CORS + `no-store`. This plan
  changes **addressing** (identity `pk_` instead of address slug) and adds
  the **page-sized** embed.
- The wildcard route `*.archura.ai/*` already sends `embed.archura.ai` to our
  Worker — no second Worker. Local has no subdomains, so the same handler
  answers the path form `/embed/<pk>/<Component>.js` on the main host (which
  works in prod too).

## Identity comes from the core (decided 2026-07-19)

`pk_` is bound up with accounts and auth, so it is **minted by the core,
never the edge** — the core is the single authorization server
(`AUTH_ARCHITECTURE.md`). `core/PLAN_EMBED_IDENTITY.md` is ACTIVE and is this
plan's dependency: email confirmation (and session-authed claims) ensure an
organization for the account+site and return its `publishable_key`. The
edge's only identity job is to **store and resolve** what the core minted.

Consequence for anonymous claim-token-only sites (no account): no pk, no
embed identity — surfaces say "register to get your embed key" instead of
inventing one.

## Work items

### 1. Store + resolve the core-minted pk (Worker)

- `handleConfirm` and claim-with-session read `publishable_key` from the core
  responses (canonical contract in `core/PLAN_EMBED_IDENTITY.md`), write it
  into the site's `meta.json`, and write the reverse index
  `pks/<pk>.json → { "site": "<slug>" }` in R2 so embed serving resolves
  pk → namespace in one read, no core round-trip.
- **Multi-site orgs (open question, deliberately deferred):** the pk is
  per-organization, and org site counts are now unrestricted — so
  `/embed/<pk>/<Component>.js` is unambiguous only while an org has one
  site. For this milestone the reverse index points at the org's
  first/default site; when a second site per org actually ships, the embed
  URL gains a site segment (decide the shape then — the doctrine says an
  identity-stable segment, not the releasable slug).
- `GET /api/sites/<site>/list` response gains `pk` (null when absent) and
  `embedBase` (see item 4) so the dashboard and publish panel build embed
  code from server-owned data.

*Verify:* after a funnel confirm, meta carries the core's `pk_…` and the
reverse index resolves it; a claim-token-only site has `pk: null`.

### 2. Page-sized embeds (editor package)

Pages are components too. Leaf components embed by trait-stamping; a page's
value is its **composition**, which lives in the published snapshot — so the
page's generated module carries the snapshot instead:

- `buildEmbedModules` additionally emits one module for the page itself
  (named by the page component, e.g. `Landing.js`): baked `snapshot.html` +
  `snapshot.css`, plus imports of the leaf component modules it uses
  (absolute URLs, same as today). On load it renders the snapshot into its
  mount element (`<archura-landing>` in the embed code) and injects the CSS
  once per document — the same mechanics as the leaf modules' style
  injection, scaled up.
- Same file layout (`sites/<slug>/embed/Landing.js`), same
  overwrite-on-publish liveness, same pk URL scheme. Nothing downstream
  distinguishes page-sized from button-sized.
- **Ruled 2026-07-19 — do not touch how embedded components work:** page
  embeds use the *same mechanics* as leaf embeds (document-level style
  injection, absolute imports, overwrite-on-publish). No CSS-isolation layer,
  **no shadow root at the page level** (StripePayment is light-DOM by
  necessity — Stripe Elements cannot mount in shadow DOM), no embed
  manifests, and **no duplicate-instance publish errors** — a page with two
  Cards publishes fine; the existing last-instance-wins behavior for embed
  export stands.

*Verify:* unit — the generated page module contains the snapshot html/css and
leaf imports; embedding `<archura-landing>` + the module on a bare page
renders the client's composed, styled page.

### 3. Embed host routing (Worker)

- Add `embed` to `RESERVED` (never claimable as a site).
- Requests to hostname `embed.<ROOT_DOMAIN>` with path `/<pk>/<Component>.js`,
  and requests on any other host with path `/embed/<pk>/<Component>.js`, both:
  validate shapes → read `pks/<pk>.json` → serve
  `sites/<site>/embed/<Component>.js` via the existing `serveEmbed()` (CORS,
  `no-store`). Unknown pk or component → 404. Generic over component names —
  pages included, nothing Stripe-specific.
- Legacy `/s/<slug>/embed/…` URLs keep serving; no surface emits them anymore.

*Verify:* pk URL and legacy URL return identical bytes; re-publishing changes
what the pk URL serves without the URL changing; unknown pk → 404; `embed`
cannot be claimed.

### 4. Environment-correct embed code (one helper, two surfaces)

- `embedBase` computed server-side next to `siteUrlFor`: local
  (`PUBLIC_ORIGIN` set) → `http://localhost:8787/embed/`, prod →
  `https://embed.<ROOT_DOMAIN>/`. Returned in `list()` (item 1).
- Dashboard "Get embed code" and the post-publish panel build the embed code
  from `embedBase + pk` — one entry per published component **including the
  page**:

  ```html
  <script type="module" src="https://embed.archura.ai/pk_abc123/StripePayment.js"></script>
  <archura-stripe-payment client-key="pk_abc123"></archura-stripe-payment>
  ```

  ```html
  <script type="module" src="https://embed.archura.ai/pk_abc123/Landing.js"></script>
  <archura-landing client-key="pk_abc123"></archura-landing>
  ```

  (`client-key` on the element now so checkout needs no changes later.)
  Copy button on both surfaces.

*Verify:* both surfaces use `embedBase` — localhost URLs locally,
`embed.archura.ai` in prod builds; no slug appears in embed code; the page
appears in the component list alongside the leaves.

### 5. Toy client server (new top-level `toy-client/`)

- `toy-client/index.html` — a fake merchant page (deliberately not our
  styling): some business copy, then an "Embed here" zone — textarea → Render
  button that injects pasted HTML (script tags re-created via `createElement`
  so modules execute). Nothing else. No persistence, no secrets, no build.
- `toy-client/serve.mjs` — dependency-free `node:http` static server, port
  **5300**. `dev-up.sh` starts it and adds a banner line.
- **Prod testing needs no second deployment:** the local toy server is a
  foreign origin to prod too — paste prod embed code
  (`https://embed.archura.ai/pk_…/…`) into `http://localhost:5300` and it
  must render (CORS already `*`). A hosted twin can come later if wanted.

*Verify:* local embed code pasted at :5300 renders the styled component
cross-origin; after the next prod deploy, prod embed code pasted into the
same local toy page renders too (manual, one pass).

### 6. End-to-end verify — `scripts/verify-embed.mjs`

Needs the local core (pk minting happens at confirmation) — SKIPs cleanly
without it, same probe pattern as `verify-funnel.mjs`:

1. Deploy + confirm a site through the funnel (magic link from the dev
   mailbox); grab `pk` from the site's `list()` response; style + publish the
   Stripe component (reuse the `verify-client-styling` driving pattern).
2. `GET /embed/<pk>/StripePayment.js` — 200, JS content type, identical bytes
   to the legacy slug URL; unknown pk → 404.
3. **Page-sized embed:** `GET /embed/<pk>/Landing.js` serves; pasting its
   embed code into the toy page renders the composed page cross-origin.
4. Dashboard embed code uses `embedBase` + pk; the page listed alongside the
   leaves; no slug, no `sk_`/claim token/`ct_` anywhere in it.
5. Paste the Stripe component's embed code via the toy textarea; assert the
   styled render on the foreign origin.
6. Re-publish a new color → the same pasted page reload shows it (URL
   unchanged, module overwritten).
7. Wire into `verify-all.mjs`.

## Deferred (deliberately)

- Secret-key exposure, checkout endpoints, Connect — later milestones; the
  pk minted here is the same key they will use.
- Metadata sidecars / per-instance module names / trait attributes rendered
  into the element — fine ideas, not needed to make pk-addressed embeds real.
- Hosted toy-client twin; versioned embed URLs.
