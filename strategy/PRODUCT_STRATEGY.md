# Archura Product Strategy

Drafted 2026-07-18, synthesizing the positioning work of this sprint. Competitive
research backing this: `../DUDA_COMPARISON.md`. Architecture references live in
`../docs/`.

## Thesis

**Archura sells embedded, metered capability — payments today, regulated data
tomorrow. The editor is the on-ramp; the revenue share is the business.**

We are not a website builder. Builders (Duda, Wix, Webflow) monetize site
inventory through subscriptions and must therefore keep value inside their
hosting. Our value deliberately leaves home: components that live on any page,
on any origin, carrying revenue with them. We earn when clients earn (Stripe
Connect application fees on every charge), not when they renew.

## What we are: one platform, three layers

1. **The component layer (the envelope).** Standards-based Lit custom elements
   with a declared contract — attributes (traits), CSS custom properties
   (styling), DOM events. Vetted code paths for the dangerous parts of an app:
   checkout now; credit data, KYC-adjacent flows later. Clients and agents turn
   knobs; the platform owns correctness and carries the liability.
2. **The edge publish plane.** Per-client namespaces (`sites/<slug>/`), claim
   tokens, artifacts, and generated per-client embed modules served from the
   edge. Publish overwrites the module; every embed updates on next load. All
   presentation data lives here — never in the core.
3. **The core money/trust plane (Go core).** The single authorization server:
   client identity, tenant → namespace bindings, component identity, and the
   tamper-proof config (Stripe price IDs, modes, origins). Only what clients
   must NOT be able to alter lives here. This is the layer a builder cannot
   casually bolt on, and the moat once regulated data arrives.

## Doctrines (decided, load-bearing)

- **Component, not widget.** A widget is a unit of the builder (proprietary
  contract, inert outside the platform — Duda's model, and why their moat is
  hosting). A component is a unit of the web: the editor merely *introspects*
  it and is one client of its contract among equals — published sites, foreign
  embeds, agents. Everything strategic follows from that dependency arrow. The
  revenue-sharing payment element on someone else's page has no widget version.
- **Edge-first.** Published/presentation data goes to the edge (R2 via the
  Worker); the core holds only tamper-sensitive or regulated data. An embedded
  component is a GET of a JS module; editing it means regenerating that module.
- **No client backend.** Guest checkout is publicly mintable: `pk_` +
  component id + origin checks + rate limits; the charge is fully determined by
  server-held config, so there is no approval decision for a client backend to
  make. The secret-key → session-token exchange is reserved for identity-bound
  scopes (a specific person's data, subscriptions, credit) where the client's
  assertion *is* the security model. Fulfillment without a client backend:
  Stripe webhooks land on us, orders recorded per tenant, surfaced in the
  dashboard — we are the no-backend client's order system of record.
- **Headless platform, three heads.** Web app for humans — and specifically for
  trust ceremonies (Connect onboarding, key reveal, "charge real money"
  approvals) plus the no-code merchant segment. MCP + CLI for agents. Embeds
  for end users. All heads consume the same Worker/core contracts; none is
  privileged. Don't become one agent's plugin; become the thing plugins are
  made of — plugins per host (opencode, Claude Code) are thin, replaceable
  distribution over the protocol surface.
- **The mistakeless envelope is for liability, not just tidiness.** Duda proved
  the pros-build/others-operate pyramid commercially for the cosmetic layer.
  We enforce the same envelope where mistakes are irreversible: an agent or
  client can restyle a checkout button but cannot make it lie about money.
- **Prototype discipline.** No staging phases, versioning, concurrency control,
  or per-principal agent credentials until the product needs them. Agents edit
  through the same editor/controller and claim token as anyone else.

## Market position (vs. Duda, condensed)

Duda sells websites to people who sell websites: agency throughput, per-site
subscriptions, value captured inside their hosting, 15 years and ~$100M ahead
on the builder. Competing there is losing ground. Our differentiation is the
embedding direction (components out onto foreign pages vs. builder embedded
into SaaS products) and the money/trust plane (metered revenue share, regulated
capability). Their 2025 MCP launch confirms agent-nativeness is becoming table
stakes — differentiation lives in *what the agent gets access to*, not in
having an MCP server. Full analysis: `../DUDA_COMPARISON.md`.

What we copy from them without embarrassment: section-library reuse economics,
permission-scoped client handoff, pricing clarity for the boring tier, and the
DX polish of a mature declared-knobs contract.

## Sequencing

1. **Now (done this sprint):** per-client styling + embed pipeline + namespace
   listing; tenant → namespace binding in core; verified end to end.
2. **M4, reshaped:** public-mint checkout (`pk_` + `cmp_`, no client backend),
   Stripe test mode; webhook → orders under tenant.
3. **Connect (the reason the rest exists):** merchants onboard as
   Standard/Express connected accounts via hosted onboarding; sessions carry
   `application_fee_amount`; Stripe splits our cut atomically at charge time.
4. **Thin dashboard:** keys, component config, orders, Connect status,
   "open editor" — the trust surface (see `../docs/DASHBOARD.md`).
5. **Agent surface:** extract the CLI from the existing verify/register
   scripts → MCP server over the same operations + component-contract
   introspection → per-host plugin as the first distribution experiment.
6. **The fintech data plane:** the credit-history component reusing the same
   contract (view-time action + per-tenant credentials + consent + audit) —
   the strategic destination the payments work rehearses.

## Risks and deadlines

- **Agent-native window.** Duda's MCP went 30 → 60+ actions in one cycle; the
  slot for "the agent-reachable commerce component" will not stay open.
- **A builder adds application fees.** If Duda (or GoHighLevel) bolts
  Connect-fee monetization onto their ecommerce, our revenue-model edge narrows
  to the embedding direction + regulated plane; their distribution then matters.
- **Builder-credibility gap.** Clients comparing our editor to Duda's will see
  the maturity delta. The embed/capability story must be legible in docs and
  pricing before that becomes the comparison being made.
- **Regulated ambitions raise the bar on ourselves.** The moment credit data
  ships, the core's audit/consent/authorization discipline stops being
  architecture taste and becomes compliance surface. Build as if audited.
