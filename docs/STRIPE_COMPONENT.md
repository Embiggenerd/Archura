# Embedded Stripe Component — Gaps and How to Close Them

Plan for a white-label Stripe payment component: a merchant configures it in the editor,
publishes it (to an Archura subdomain or embeds the module on their own site), and their
customers can pay. Same house style as `GAPS_AND_SOLUTIONS.md` / `EDITOR_PARITY.md`:
problem → solution → verify, phased, honest about scope.

## Why this matters beyond itself

> **Terminology:** "the Worker" is our entire backend — `workers/site-worker.js` on
> Cloudflare. There is no separate server. Where this doc says "in the Worker" it means
> the trusted backend (as opposed to the browser); the only other "side" mentioned is
> Stripe's own infrastructure, called out explicitly.

The Stripe component is the **first data-connected component** — one that acts against the
Worker at view time rather than just rendering attributes. That primitive (view-time
fetch/action + per-tenant credentials + a Worker endpoint) is exactly what the fintech
credit-history component needs later. So this is not a detour from the product vision; it
is the payments-shaped rehearsal of the fintech data plane, on content that can't create
regulatory exposure. Every gap below is shared with that future.

## Monetization — the actual reason to build this (Stripe Connect)

Level 1 (below) makes payments *work*; **Stripe Connect makes payments *pay us*** — and
the second is the point. This is the model Polsia uses: it provisions each client's Stripe
as a **connected account under its Connect platform** and takes ~20% of everything that
flows through it. We can adopt the identical monetization for the white-label component
without the autonomous-operator premise.

- **Mechanism — application fees.** When a platform processes a payment through a connected
  account, it sets an `application_fee_amount`; Stripe **splits the money atomically at
  charge time** — our cut to the platform account, the remainder to the merchant — then
  deposits both. We never hold the full amount and invoice for a slice.
- **Why this is the strong part:** the revenue share is **enforced by Stripe's money
  movement, not by trust.** Stripe deducts our fee first, on every transaction, from
  merchants we never bill. A percentage cut becomes a clean, automatic, self-enforcing
  revenue stream — the same "we host and power it, we take a cut" logic as the component
  marketplace, extended to payments.
- **Account type — use Standard or Express connected accounts.** The merchant keeps their
  own Stripe relationship and Stripe carries KYC/compliance/liability, while we still
  collect application fees. "Custom" accounts give more control but pull real liability
  onto us — avoid until there's a reason.
- **Reframing:** the component isn't just a feature we ship; it's a **metered revenue
  engine**. This is what makes the whole build worth it, and it separates cleanly from
  Level 1 — you can ship checkout first, then turn on Connect to monetize it.

Sequencing note: Connect sits *on top of* a working Checkout flow, so it's phased last
(Phase 5) — but it is the strategic goal the earlier phases exist to reach, not an
afterthought.

## Guardrails (non-negotiable)

- **Never touch card data.** Use Stripe-hosted Checkout (redirect or Stripe.js embedded).
  Card details never reach the Worker or the merchant's page, keeping us in the lightest
  PCI scope (SAQ A). We never build a card form.
- **Credentials are Worker-only.** A tenant's Stripe secret/restricted key lives in the
  Worker's store, keyed by site, never in an artifact, the browser, or component code —
  the same presentation/host boundary that is the fintech compliance boundary.
- **Mistakeless envelope holds.** The merchant configures the component (which price,
  button label, success URL) through traits; they cannot write payment logic. The charge
  flow is a vetted Worker code path. For payments, "clients turn knobs, platform owns
  correctness" is a real safety property, not just philosophy.

## What already exists (foundation built by prior work)

- **Serving Worker + subdomains + deploy** (`workers/site-worker.js`, live on archura.ai).
- **Cross-origin embed loading, proven** — component modules are served with CORS and
  render on a foreign host (verified by `scripts/verify-invariants.mjs`).
- **Token-gated write endpoints + per-site identity** — the asset pipeline (`PUT
  /api/assets/...`, claim-token auth) and `sites/<site>/meta.json` are the template for
  both the data plane and the credentials store.
- **Mature component contract** — traits (content), asset traits, styleParts, the
  registry. Everything the Stripe component needs *except* the ability to act at view time.

---

## Gap 1 — Data-connected component contract (shared, new primitive)

### Problem

Every component today is presentational: it renders from attributes and fetches nothing.
A payment button must **act at view time** (create a checkout), know **where** to act
(the Worker API base) and **as whom** (which site/tenant), and behave differently in the
editor (inert preview) vs a published/embedded page (live).

### Solution

- **Config via attributes baked into the embed**: `api="https://archura.ai"`,
  `site="mikes-bakery"`. On an Archura subdomain these default from the host; in a
  white-label embed they are written into the snippet (Gap 5). Relative URLs are unsafe
  here — the component lives on a foreign origin — so the api base is always absolute.
- **Editor vs live detection**: the component treats "no api base / editor context" as
  preview mode — the button renders and is styled but clicking is inert (or shows a
  "test mode" note). Only a real api base arms it. This is the mock-in-editor /
  live-on-site rule.
- **States**: idle / working / success / error are part of the component, not the page.
- The action itself is a single `fetch` to the Worker; the contract is just "absolute api
  base + site id + declared states."

### Verify

The component renders and is stylable in the editor with clicking inert; on a page with a
real api base a click reaches the Worker. (Reuses the foreign-origin harness from
`verify-invariants`.)

---

## Gap 2 — Worker actions plane (+ CORS)

### Problem

The Worker has GET/PUT for artifacts and assets but no **action** endpoint that does
work in the Worker. Creating a Checkout Session is a Worker action (needs the secret key).

### Solution

- `POST /api/checkout/<site>` — creates a Stripe Checkout Session with the tenant's key
  and returns the hosted `session.url` (or a `client_secret` for embedded checkout).
- **CORS required** — embeds call this from foreign origins; reuse the `withCors` helper
  already added for `/components`.
- **Anti-tampering (important):** the client must not be able to dictate the amount. Use
  the **Stripe Price ID model** — the merchant creates products/prices in their Stripe
  dashboard and puts the Price ID in the component's trait; the client passes only that
  ID, and Stripe enforces the amount **on Stripe's side**. (Alternative: amount-as-trait
  with inline `price_data`, but only safe if the amount is stored in the Worker per
  product, not
  taken from the client. Price ID is simpler and safe by construction.)
- **Rate limiting** on the endpoint (Workers rate-limit binding) so session creation can't
  be spammed.

### Verify

`POST /api/checkout/<site>` with a test Price ID returns a Stripe test-mode session URL;
a tampered amount cannot change the charge (Stripe enforces the Price).

---

## Gap 3 — Per-tenant Stripe credentials (private config)

### Problem

Level 1 needs the tenant's Stripe key in the Worker. Sites today have only a claim-token
hash; there is no place for third-party secrets, and secrets must never enter artifacts.

> Note: this Worker-held placement is for the pre-regulated demo. Once regulated money
> logic exists, secrets and payment logic move into the Go core per
> `FINTECH_ARCHITECTURE.md` §Secrets — same principle (never client-side), stronger place.

### Solution

- Extend the site record with a **secrets side**: store the tenant's Stripe **restricted**
  key (scoped to Checkout + read) at `sites/<site>/secrets.json` (or a KV/secret binding),
  written through an authenticated **site-settings endpoint**, never returned to the
  browser after being set.
- A minimal **"Payments" settings surface**, claim-token gated. Two paths converge here:
  - **Level 1**: the merchant pastes their restricted key (stored as above).
  - **Connect (Phase 5)**: instead of a pasted key, the merchant clicks "Connect Stripe"
    and goes through Stripe's **hosted onboarding / OAuth** — this creates the connected
    account and hands us an account id, not a raw secret. This is *better* for us: Stripe
    holds the credentials and KYC; we hold only the account id and charge through it with
    application fees. So Connect actually *simplifies* the credentials problem rather than
    adding to it.
- The checkout endpoint reads the key (or connected account id) inside the Worker only.

### Verify

Setting a key stores it in the Worker and it is never echoed back; checkout uses it; a site
without a key returns a clear "payments not configured" error (routed through `onError`).

---

## Gap 4 — The Stripe component itself

### Problem

No payment component exists.

### Solution

- `StripeButton` (Base contract, fully stylable via custom props like any component):
  traits `priceId`, `label` ("Buy now"), `mode` (`payment` | `subscription`),
  `successPath`, `cancelPath`. `api`/`site` from Gap 1.
- On click (live mode): `POST /api/checkout/<site>` with `priceId` + success/cancel →
  redirect to the returned Stripe URL. In editor/preview: inert with a "test mode" hint.
- Registered like any component; introspected traits give it its editor UI for free.

### Verify

Configure a Price ID and label in the editor, publish, click on the live page → lands on
Stripe test-mode checkout; the test card (`4242…`) completes and redirects to `successPath`.

---

## Gap 5 — Embed ergonomics (white-label snippet)

### Problem

The subdomain path works, but the white-label story needs a copy-paste embed, and module
URLs need to be version-stable for third parties.

### Solution

- A **"Get embed code"** view per component: a `<script type="module" src=".../v1/...">`
  plus the element with `api`/`site` and configured traits filled in.
- **Versioned, immutable component URLs** (`/v1/…`) so an embedded merchant's component
  never changes under them on our redeploys.

### Verify

Paste the snippet into a bare foreign-origin page (the `verify-invariants` embed harness)
→ the button renders, styled, and a click reaches checkout.

---

## Gap 6 — Webhooks & fulfillment (reliability beyond a demo)

### Problem

Success redirects are not guaranteed (user closes the tab); real fulfillment needs the
Worker to be told authoritatively that payment succeeded.

### Solution

- `POST /api/stripe/webhook` — verifies the Stripe signature (`stripe-signature` +
  webhook secret) and records the completed payment (`sites/<site>/orders/...`).
- For a minimal demo this is optional (rely on the success redirect); for anything real it
  is required, so scope it as its own phase rather than skipping it silently.

### Verify

A Stripe test webhook event with a valid signature records an order; an invalid signature
is rejected.

---

## Phasing

1. **Level 0 — Payment Link button (ships now, no backend).** A component whose trait is a
   Stripe Payment Link URL (merchant creates it in their dashboard); the button links to
   it. No Gaps 1–3 needed — only the component + embed. Proves the shape and the embed end
   to end, immediately.
2. **Foundation + Level 1 — real Checkout (test mode).** Gap 1 (data contract) → Gap 2
   (checkout endpoint) → Gap 3 (credentials) → Gap 4 (component). The reusable core; do it
   with Stripe **test keys** throughout so the full flow is verifiable without real money.
3. **Gap 5 — white-label snippet + versioned URLs.** Makes Level 1 embeddable off-platform.
4. **Gap 6 — webhooks + fulfillment.** Reliability for real use.
5. **Stripe Connect (Level 2) — the monetization goal (see Monetization section).**
   Merchants onboard as Standard/Express **connected accounts** via Stripe hosted
   onboarding; checkout sessions created on their behalf carry `application_fee_amount`, so
   Stripe splits our cut off atomically at charge time. This is the *reason to build the
   whole thing* — it sits on top of a working Level 1 flow, hence phased last, but it is
   the strategic goal, not an afterthought. (Polsia's ~20% revenue share is this
   mechanism.)

## Testing note

Everything through Level 1 is verifiable in **Stripe test mode** (test restricted keys,
card `4242 4242 4242 4242`) — no real charges. The verify suite drives: configure in
editor → publish → click on a foreign-origin page → complete test checkout → assert the
success redirect and (Phase 4) the recorded order.

## The reusable payoff

Gaps 1–3 are not Stripe-specific — they are "a component that acts at view time against a
Worker endpoint using per-tenant credentials." The credit-history component is the same
shape plus FCRA constraints (consent, audit, a sponsor provider). Building Stripe Level 1
well *is* building the fintech data-plane pattern on safe content.
