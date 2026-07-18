# Duda vs. Archura — Competitive Findings

Research date: 2026-07-17. Sources listed at the end. Companion strategy context:
the agent-native positioning discussion summarized in §7.

## 1. Who Duda is

- Founded 2009 (Palo Alto), ~$100M raised across 3 rounds, Series D. Founders Amir
  Glatt and Itai Sadan.
- A website builder sold **exclusively to professionals** — agencies, freelancers,
  and SaaS platforms. Never to end merchants directly.
- Three pillars:
  - **White-label builder for agencies** — agencies resell sites under their own
    brand. White Label plan ~$149/mo for 4 sites; general plans $25–$199/mo with
    ~20–24% annual discounts. One of the three biggest white-label players
    (alongside GoHighLevel and Simvoly).
  - **Duda for SaaS** — the builder embedded *inside* other SaaS products via
    Partner API + SSO ("so thoroughly and seamlessly … it almost feels native"),
    volume-based pricing, vertical integrations (booking, listings, payments).
  - **Ecommerce as a per-site add-on** — $8 / $22 / $52 per site per month by
    product count (100 / 1,000 / 20,000 products).
- Hosting on AWS, 99.95% uptime, unlimited bandwidth/storage, GDPR/CCPA handled
  centrally. Claims: sites built up to 75% faster than competing platforms; ~50%
  less build time, ~75% less maintenance.
- **Shipped an MCP server (2025)**: 30+ live actions (60+ demoed at DudaCon) —
  add clients, publish blogs, generate collections, check form submissions — from
  any MCP-compatible assistant, authenticated per account, backed by their REST
  API. Marketed as part of a "full-stack AI for web professionals" push.

## 2. How their builder works — and why it's shaped that way

The builder is drag-and-drop over a widget system (flexbox/CSS Grid), but every
feature serves **agency throughput**, not authoring:

- **Sections/templates as a team library** — build once, reuse across all client
  sites; the agency's real asset becomes its private library of proven sections.
- **Global design tokens** — one source of truth for fonts/colors per site
  (structurally our theme custom-props layer).
- **Connected data + Collections** — content lives in collections (internal,
  Google Sheets, Airtable, external APIs); widgets bind to fields via
  "Connect to Data."
- **Dynamic Pages** — one template + a collection stamps out hundreds of pages;
  their scale weapon (an agency serving 40 dentists builds one system, not 40
  sites).
- **Escape hatches by depth** — HTML embed widget → Custom Widget Builder
  (HTML/CSS/JS with *declared* Content/Design inputs, so hand-written code gets a
  no-code editing UI and can bind to collections) → Dev Mode (direct frontend
  code).
- **Client handoff** — granular permissions (one client writes blogs, another
  only comments, another edits design), preview links, in-line client comments.

Business fit: the customer is the agency; its economics are *win → build fast →
hand off safely → maintain cheaply → hold the relationship*. Every builder
feature maps to one of those, and per-site subscription pricing means Duda earns
from the agency's inventory of sites — so throughput features are directly
monetized. The builder is a factory, not a canvas.

Philosophy, per their own framing ("purposefully designed to help professionals
build and manage websites at scale"): (1) **pros only**, never a consumer tier —
keeps the feature bar coherent; (2) **leverage over magic** — AI "elevates your
workflow without replacing it," careful not to threaten their own customer;
(3) a **pyramid of control** — developer writes code once, team assembles
visually, client gets a permission-scoped sliver. That pyramid is our
"mistakeless envelope," proven commercially — but only for the cosmetic layer of
the web. We enforce the same envelope for *correctness and liability*
(payments, regulated data), which is a harder and more valuable guarantee.

Worth copying shamelessly: section-library reuse economics, permission-scoped
client handoff, and the DX polish level of their widget contract (Academy /
University training materials).

## 3. Widget vs. component — the load-bearing distinction

**A widget is a unit of the builder. A component is a unit of the web.**

- A Duda **widget** exists inside their platform: its contract (declared
  Content/Design inputs, SCSS, data bindings) is proprietary, interpreted by
  Duda's editor, rendered by Duda's runtime, on Duda-hosted pages only. Widgets
  are leaves; composition happens on the builder's canvas. Outside Duda a widget
  is inert. The builder is the host — and therefore the moat.
- An Archura **component** is a Lit custom element whose contract is the web
  standard itself: tag name, attributes (traits), CSS custom properties
  (styling), DOM events. The editor doesn't define it — it *introspects* it, and
  is just one client of the contract; published sites, foreign embeds, and
  agents are the others, none privileged.

Both systems converged on "hand-written code with declared knobs," but the
dependency arrow differs: widget = code wrapped *so the builder can host it*;
component = builder built *to edit things that live without it*. Everything
strategic follows from that arrow — Duda must capture value through hosting and
per-site subscriptions (their embed story is "put our *builder* in your SaaS,"
never "put our *widget* on your page"), while our embed pipeline updates a
component on an origin we don't control. A revenue-sharing payment element on
someone else's website has no widget version. It also matters for agents: using
a standards-based component means emitting a script tag and an element — which
any codegen model already knows — while using a widget requires knowing Duda.

Caveat to keep us honest: the boundary is architectural, not lexical. The
discipline that keeps us on the right side is that the component contract
(attributes, custom props, events) is *the* contract, consumed identically by
the editor, the publisher, the embeds, and agents.

## 4. Side by side

| Dimension | Duda | Archura |
|---|---|---|
| Unit of product | The **website** | The **component** (payment button, future credit widget) |
| Customer | Agencies/SaaS who resell sites | Clients embedding capability into their own properties |
| Embedding direction | Builder embedded *into* SaaS products | Components embedded *out* onto any page/origin |
| Revenue | Per-site subscription + add-ons | Metered: Stripe Connect application fees + hosting |
| Payments | Ecommerce feature (per-site store) | Core monetization engine (revenue share on every charge) |
| Regulated data | None | Planned fintech/FCRA data plane; Go core as single authorization server |
| Agent story | MCP server shipped, 30–60 actions | Controller-drivable today; MCP/CLI planned |
| Maturity | 15 yrs, mature editor, app store, agency channel | Prototype at editor-parity stage |

## 5. What Duda validates about Archura's bets

- **B2B2C white-label** is a real, durable market with proven professional demand.
- **"Professionals only" discipline** kept their product coherent for 15 years —
  same scoping instinct as our thin-dashboard / merchant-staff-first plan.
- **Agent-native platforms are the direction**: their MCP launch is near
  word-for-word the "expose real platform actions to any MCP assistant" strategy
  we settled on. Confirmation — and a deadline (see §7).
- **The SaaS-partner motion** (volume pricing, SSO, feels-native embedding) is a
  proven playbook our white-label plan rhymes with.

## 6. Where Archura is differentiated (and should stay)

1. **Embedding direction.** Duda embeds their *builder* into SaaS products.
   Nobody in that market embeds *individual, live-updating, revenue-bearing
   components* onto arbitrary foreign pages. Our embed-module pipeline (publish →
   per-client module overwritten at the edge → every embed updates on next load)
   has no Duda equivalent; their ecommerce lives inside Duda-hosted sites.
2. **The money/trust plane.** Application-fee revenue share means we earn when
   clients earn, not when they renew. The regulated-capability layer (payments
   now, credit data later, audit + authorization in the core) is not something a
   website builder can casually bolt on — it is a different kind of company with
   liability at the center. This is the defensible depth.
3. **The mistakeless envelope for agents.** In an agent-built-apps future, agents
   generate UI freely but cannot safely generate payment/credit/KYC flows. Our
   components are the safe primitives for the dangerous 10% of an app. Duda's MCP
   lets an agent manage websites; ours would let an agent drop a revenue-sharing,
   compliance-bounded capability into anything it builds.

## 7. Strategic implications

- **Do not compete on the builder.** Duda's moat is builder maturity plus a
  15-year agency channel. Editor parity work is for credibility, not positioning.
  If the pitch reads "a website builder, but newer," we are a small Duda. Their
  per-site subscription model is also the one we deliberately did not choose.
- **Agent-nativeness is becoming table stakes, not a differentiator.** Ship the
  protocol surface (CLI extracted from the existing scripts → MCP server →
  per-host plugins as thin distribution), but differentiate on *what the agent
  gets access to*, not on having an MCP server.
- **Steal their pricing clarity for the boring tier** (hosting/sites) so the
  interesting tier (payment share) stays the headline.
- **Positioning in one line:** Duda sells websites to people who sell websites.
  Archura sells *embedded, metered capability* — payments today, regulated data
  tomorrow — where the editor is the on-ramp and the revenue share is the
  business. When that inversion is legible in our docs and pricing, Duda stops
  being a competitor and becomes the company we are explicitly not.

## 8. Threats to watch

- Duda (or a peer) adding Connect-style application-fee monetization to their
  ecommerce tier would blunt our revenue-model differentiation; their
  distribution would then matter a lot.
- Their MCP action surface is growing fast (30 → 60+ actions in one cycle); the
  window to be *the* agent-reachable commerce component is not indefinite.
- Our builder-credibility gap: clients evaluating us against Duda's editor will
  notice the maturity delta. The embed/capability story must land before that
  comparison is the one being made.

## Sources

- https://www.duda.co/ (homepage, "AI-Ready Website Platform Built for Pros")
- https://www.duda.co/website-builder/white-label
- https://www.duda.co/features/white-label-features
- https://www.duda.co/solutions/saas-platforms
- https://www.duda.co/pricing
- https://www.duda.co/ecommerce/pricing
- https://blog.duda.co/duda-mcp
- https://developer.duda.co/docs/dudas-mcp
- https://www.duda.co/product-updates/join-the-mcp-beta-put-your-favorite-ai-assistant-to-work-for-you-in-duda
- https://www.duda.co/ai-stack
- https://blog.duda.co/dudacon-2025
- https://insideainews.com/2025/07/18/duda-unveils-full-stack-ai-for-web-professionals/
- https://www.crunchbase.com/organization/duda
- https://tracxn.com/d/companies/duda/__TmsWWkryELKkTps35f1V7Mr0bI0uZLW3glu6rrFWK2w
- https://www.capterra.com/p/134280/DudaMobile/
- https://simvoly.com/the-best-white-label-website-builder
- https://www.duda.co/website-builder (builder mechanics, philosophy)
- https://www.duda.co/features/dynamic-pages
- https://developer.duda.co/docs/dynamic-pages
- https://support.duda.co/hc/en-us/articles/26519939732375-Dynamic-Content-Overview
- https://support.duda.co/hc/en-us/articles/26519939555095-Dynamic-Content-Collections
- https://academy.duda.co/course/custom-widget-builder
- https://university.duda.co/building-custom-widgets
