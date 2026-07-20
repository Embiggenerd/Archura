# Outseta-to-Duda Growth Strategy for Archura

**Decision:** Begin with an Outseta-like customer and business control plane, then expand into a Duda-like website-production platform.  
**Research snapshot:** July 17, 2026  
**Status:** Product sequencing reference, not an implementation specification.  
**Related analysis:** [`DUDA_PLATFORM_REFERENCE.md`](DUDA_PLATFORM_REFERENCE.md)

## Executive conclusion

The transition makes strategic and technical sense if Archura builds an **Outseta-shaped foundation for Duda-shaped customers**.

The first phase should not be a complete Outseta clone. It should be the smallest coherent system for launching, monetizing, and managing customer relationships:

- tenant accounts, people, teams, and roles;
- authentication and membership;
- plans, subscriptions, entitlements, and payments;
- embeddable signup, login, checkout, and profile components;
- customer activity and transactional events;
- APIs, webhooks, audit, and usage metering.

These capabilities later become the control plane surrounding sites, templates, editors, domains, content, publishing, and agency operations. The early work compounds instead of being replaced.

The critical condition is market continuity:

> Phase 1 must serve organizations that can naturally grow into managing customer-facing sites—not a disconnected market that would require a later customer pivot.

The preferred early customers are agencies, product studios, vertical SaaS companies, membership/service platforms, and businesses managing many downstream customers.

## 1. The strategic progression

```text
Phase 1: customer and revenue infrastructure
    identity + billing + entitlements + embeds + activity
                              ↓
Phase 2: managed web presence
    sites + domains + templates + content + publishing + simple editing
                              ↓
Phase 3: website-production platform
    fleet management + professional editor + white label + APIs + AI
```

This is not a pivot from one unrelated product to another. It is an expansion outward from the customer account:

1. First, Archura knows **who the customer is, what they bought, and what they may do**.
2. Next, Archura manages **the customer’s components and web presence**.
3. Finally, Archura lets partners **provision and operate many customer businesses and sites at scale**.

## 2. Why the transition works

Outseta-like and Duda-like products share much of the same foundation. Their main difference is what is built on top of it.

| Outseta-like foundation | Duda-like evolution |
|---|---|
| Account or company | Client business, agency tenant, or site owner |
| Person and team member | Staff member, client editor, site member, or viewer |
| Role | Site, content, commerce, or publishing role |
| Plan and subscription | Website package, site credit, or premium module |
| Entitlement | Permission to edit, publish, use AI, access commerce, or install an extension |
| Signup/login embed | White-label onboarding and editor access |
| Checkout component | Site purchase, upgrade, commerce, or paid membership |
| Profile and billing portal | Client dashboard and site-management portal |
| CRM activity timeline | Customer, site, content, publish, and payment activity |
| Transactional event | Webhook, automation trigger, audit event, or agent context |
| Customer API | Partner provisioning and site-management API |
| Embeddable UI | Component, widget, editor, or complete site surface |

The shared resources should use stable identities and versioned contracts from the beginning. A person should not have to be recreated as a different kind of user when sites arrive. A subscription should be able to grant site capabilities through entitlements instead of hard-coded product checks.

## 3. The product we should build first

### Product definition

The first product is a **white-label customer platform for digital businesses**. It gives a business the backend and embeddable surfaces needed to acquire, authenticate, charge, and serve its customers.

It should initially provide five connected capabilities.

### A. Identity and organization

- tenant/business accounts;
- people and team membership;
- invitation and account-recovery flows;
- tenant-scoped roles;
- authentication sessions;
- external identity handoff where the host owns authentication;
- audit of identity and permission changes.

### B. Plans, payments, and entitlements

- free and paid plans;
- subscriptions, trials, upgrades, downgrades, and cancellation;
- one-time purchases where required;
- Stripe integration and Stripe Connect where platform economics require it;
- invoices and payment-method management;
- entitlement calculation from plan, purchase, role, and policy;
- server-authoritative payment and subscription state.

### C. Embeddable customer surfaces

- signup;
- login;
- checkout;
- profile and password management;
- team-member management;
- plan and billing management;
- a small customer portal shell.

These should be standard web components using the same manifest, styling, origin, token, and lifecycle principles that future Archura components will use.

### D. Customer record and activity

- a customer/account record;
- contact attributes and tags;
- subscriptions and entitlements;
- component and product usage;
- event/activity timeline;
- internal notes only if demanded by real workflows;
- imports, exports, API access, and webhooks.

This is **CRM-lite**, not a general sales CRM. It exists to understand and operate the customer lifecycle inside Archura.

### E. Transactional communication

- account confirmation and recovery;
- invitations;
- receipts and billing notices;
- subscription lifecycle notifications;
- configurable event-driven messages;
- delivery status and audit.

A broad newsletter, campaign, segmentation, and marketing-automation product is deliberately deferred.

## 4. What “Outseta-like” means—and does not mean

Outseta currently combines payments, authentication, CRM, email marketing, help desk, and reporting. Its advertised plans start at $47 per month with a 2% transaction fee, while higher tiers reduce the fee to 1% and increase contact capacity. See [Outseta pricing](https://www.outseta.com/pricing).

The useful Outseta ideas are:

- one coherent customer lifecycle instead of several disconnected tools;
- embeddable signup, login, and self-service profile/billing experiences;
- pricing that begins accessibly and expands with customer success;
- account, membership, subscription, and communication data in one place;
- a product usable with an existing website or application.

Archura should not initially reproduce:

- a full email-marketing suite;
- a general-purpose sales CRM and deal pipeline;
- a complete help desk;
- complex marketing automation;
- a Chargebee-level billing engine;
- a broad integrations marketplace;
- every payment method, tax regime, and revenue-recognition scenario.

Those are deep product categories with weak leverage toward the Duda phase. Build them later only when customer demand and economics justify them.

## 5. Phase 2: expand into managed web presence

Once the customer and revenue control plane is reliable, each tenant can gain one or more site resources.

### New resources

- `Site`;
- `Domain`;
- `Page`;
- `Template` and `TemplateVersion`;
- `Theme`;
- `ContentRecord`;
- `ArtifactVersion`;
- `PublishRecord`;
- site-specific membership and permissions.

### Initial web-presence capabilities

- create a site from a versioned template;
- map a subdomain or custom domain;
- collect business information and assets;
- bind reusable content into components;
- publish a multipage site;
- preview and roll back versions;
- provide a constrained Simple/Client editing mode;
- expose page metadata, navigation, and basic analytics;
- attach existing signup, profile, membership, and checkout components.

This phase creates the bridge between Outseta-like infrastructure and Duda-like operations. Identity and billing are no longer generic backend modules; they become native capabilities available to every site.

### Why this phase is commercially natural

The Phase 1 customer already uses Archura to operate customers or members. Offering a managed web presence increases the value of the same account:

- a membership operator adds a member site;
- a vertical SaaS company provisions sites for its customers;
- an agency adds billing, portals, and ongoing site management;
- a service business adds booking, payment, or gated-client components;
- a product studio standardizes launch infrastructure for every client.

## 6. Phase 3: become Duda-like

The Duda-like phase adds production leverage for organizations managing many sites.

### Control-plane expansion

- site fleet dashboard;
- staff and client accounts;
- granular site and editor permissions;
- element, section, and capability locking;
- white-label domains, routes, emails, login, and support surfaces;
- destination-scoped SSO;
- account plans plus active-site subscriptions;
- provisioning, domain, content, publish, and analytics APIs;
- lifecycle webhooks and automation;
- usage, reliability, and portfolio reporting.

### Production expansion

- professional editor mode;
- reusable site, page, and section templates;
- client content-collection workflows;
- structured collections and dynamic pages;
- reusable component/widget catalog;
- template migrations and compatibility checks;
- collaboration, comments, approvals, and scheduled publishing;
- extension installation and version lifecycle.

### Agent expansion

- read tools across customers, sites, content, subscriptions, and analytics;
- typed mutation operations;
- previewable multi-resource diffs;
- version checks and idempotency;
- human and policy approvals;
- audit and rollback;
- MCP only after the underlying operation catalog is stable.

Duda validates the commercial model of combining an account capability plan with recurring site subscriptions and premium modules. See [Duda pricing](https://www.duda.co/pricing) and the deeper analysis in [`DUDA_PLATFORM_REFERENCE.md`](DUDA_PLATFORM_REFERENCE.md).

## 7. The key go-to-market condition

The transition succeeds only if Phase 1 attracts customers with a plausible need for Phase 2 and Phase 3.

### Preferred initial buyers

| Buyer | Phase 1 problem | Natural expansion |
|---|---|---|
| Digital agency | Fragmented client signup, billing, portal, and component stack | Build and manage client sites |
| Product studio | Rebuilding auth/billing/customer infrastructure for every project | Standard templates, deployment, and multi-client operations |
| Vertical SaaS company | Needs embedded customer identity, billing, and branded portals | Provision websites and business components for every account |
| Membership/service platform | Needs signup, gated access, subscriptions, and customer management | Member sites, content, bookings, and branded experiences |
| Multi-location or franchise operator | Needs tenant identity, permissions, and payments | Centrally governed local sites and content |

### Weak initial buyers

The fit is weaker when a buyer wants only:

- generic internal CRM;
- bulk email campaigns;
- help-desk ticketing;
- standalone authentication at infrastructure pricing;
- enterprise billing orchestration unrelated to web presence;
- a one-off consumer website.

Serving those markets would pull the roadmap toward mature point-solution competitors and away from the eventual site platform.

## 8. Positioning

Avoid positioning the first product as:

> Another all-in-one SaaS back office.

Preferred positioning:

> **A white-label customer platform for launching, monetizing, and managing digital businesses—starting with identity, billing, portals, and components, then expanding into complete web-presence management.**

A shorter product promise could be:

> **One customer system. From signup to site.**

This framing leaves room to grow without claiming functionality that does not yet exist.

## 9. Architecture rules that preserve the transition

### 1. Model tenant and customer identity once

Accounts, people, roles, and sessions must be usable by components, portals, editors, sites, and partner APIs. Do not create an editor-specific identity silo later.

### 2. Make entitlements generic

Plans and purchases should grant named capabilities. Future capabilities such as `site:create`, `site:publish`, `editor:advanced`, `ai:use`, or `commerce:manage` should not require a billing-model rewrite.

### 3. Use stable resources and events

Every account, person, subscription, component, site, content record, and publish version needs a stable identifier. Lifecycle changes should produce typed, versioned events.

### 4. Keep live business state server-authoritative

Payment, subscription, identity, permission, inventory, and regulated state belongs in the core system of record. Published artifacts may display or request it but may not become its authority.

### 5. Use one component contract

Signup, profile, checkout, content, and future site widgets should share:

- manifests and versioning;
- traits/content inputs;
- curated styling controls;
- asset and dependency declarations;
- token exchange and origin rules;
- events and action contracts;
- editor and standalone rendering behavior.

### 6. Preserve host integration and portability

Archura can provide the easiest managed path while keeping embeddable components and canonical artifacts usable in customer-owned products and deployments.

### 7. Treat agent actions as transactions

Agents should invoke typed operations with permissions, version checks, previews, approvals, audit, and rollback—not mutate arbitrary HTML or database fields.

## 10. Pricing evolution

Pricing should evolve without forcing existing customers onto a completely different model.

| Phase | Primary price dimensions | Expansion revenue |
|---|---|---|
| 1. Customer platform | Base account, active contacts/accounts, payment volume, premium components | Higher limits, advanced permissions, branded portal, API usage |
| 2. Web presence | Base account plus active sites or published experiences | Domains, managed hosting, premium templates, memberships, transaction components |
| 3. Production platform | Operator capability plan plus site credits/subscriptions | AI/automation, advanced API, white label, commerce, extensions, enterprise support |

### Pricing principles

- Charge for delivered value, not every internal user seat.
- Keep an accessible starting price for small operators.
- Let revenue expand with active customers, sites, modules, and transactions.
- Do not rely exclusively on transaction fees; customers may resist them at scale.
- Use Stripe Connect/application fees only where Archura participates meaningfully in the transaction workflow.
- Grandfather or translate early entitlements cleanly when site plans arrive.

## 11. Recommended build sequence

| Stage | Deliverable | Why it belongs now | Exit test |
|---|---|---|---|
| 1. Tenant identity | Accounts, people, teams, roles, sessions | Foundation for every later surface | Two tenants with overlapping emails remain strictly isolated |
| 2. Billing and entitlements | Plans, subscriptions, webhook reconciliation, capability grants | Creates revenue and reusable authorization | Payment-state changes deterministically update entitlements |
| 3. Embeddable lifecycle components | Signup, login, checkout, profile/billing | Immediate customer-facing product | Components work standalone and inside an Archura page without secrets |
| 4. Customer record and events | CRM-lite record, activity timeline, API, webhooks | Makes the system operable and extensible | Customer lifecycle is reconstructable from authoritative records/events |
| 5. Portal and transactional communication | White-label portal shell and event messages | Completes the first sellable workflow | A customer can self-serve signup through cancellation |
| 6. Site resource and multipage publishing | Site manifest, pages, routes, domains, versions | Begins the web-presence expansion | Create, publish, update, and roll back a multipage site |
| 7. Templates, themes, and content intake | Reusable provisioning and structured business data | Creates production leverage | Provision multiple isolated sites from one template |
| 8. Client and professional editor modes | Capability policies, locks, approvals | Enables safe delegation | Server rejects every out-of-policy edit/publish action |
| 9. Fleet, white label, and partner API | Multi-site operations, SSO, provisioning, metering | Completes the Duda-like control plane | Partner provisions and manages sites without shared secrets |
| 10. Collections, extensions, and agents | Dynamic content, versioned modules, safe operation catalog | Expands after core contracts stabilize | Upgrade, agent mutation, and rollback fixtures are deterministic |

## 12. Evidence gates before advancing

The roadmap should advance based on evidence, not merely completion of features.

### Move from Phase 1 to Phase 2 when

- customers repeatedly ask for a hosted portal, landing site, member area, or customer-facing pages;
- embeddable components are already used across multiple host technologies;
- account, permission, billing, and entitlement models are stable;
- customers will pay to consolidate their web presence into the same platform;
- publishing and rollback can meet production reliability expectations.

### Move from Phase 2 to Phase 3 when

- a meaningful segment manages more than one site or downstream customer;
- templates and structured content demonstrably reduce production time;
- customers ask for client roles, white labeling, SSO, or provisioning APIs;
- active sites per account are rising;
- support patterns justify professional/client editor modes;
- unit economics can support hosting, support, and site-level operations.

## 13. Principal risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Building all of Outseta | Years spent in email, CRM, and support categories | Limit Phase 1 to lifecycle infrastructure that compounds into sites |
| Wrong first customer | Later Duda phase becomes a market pivot | Target agencies, vertical SaaS, studios, and multi-customer operators |
| Commodity auth positioning | Price pressure and weak differentiation | Sell the integrated customer-to-site lifecycle, not token issuance |
| Billing complexity | Reliability/compliance burden consumes roadmap | Start with a constrained Stripe model and server-authoritative webhooks |
| Two disconnected product models | Rewrite when sites arrive | Establish shared account, entitlement, component, event, and audit contracts now |
| Premature freeform builder | High support cost and broken output | Preserve Archura’s constrained editing envelope |
| Too many pricing dimensions | Confusing sales and migrations | Introduce new dimensions only when the associated value ships |
| Unsafe agent automation | Customer trust and data loss | Typed operations, preview, approval, audit, conflict detection, rollback |

## 14. Metrics

### Phase 1

- time to first successful signup and payment;
- activation rate for embedded components;
- active customer accounts per tenant;
- payment and entitlement reconciliation failures;
- self-service profile/billing completion rate;
- monthly recurring revenue and payment volume;
- expansion and churn by customer type;
- percentage of lifecycle events handled without support.

### Transition metrics

- percentage of customers asking for customer-facing pages or sites;
- number of host technologies using Archura components;
- percentage of tenants managing multiple downstream accounts;
- attach rate for portal, content, and publishing features;
- willingness to pay for hosted sites and white labeling.

### Duda-like phase

- active sites and net site additions per account;
- sites managed per operator;
- template and component reuse rate;
- time from content received to publish;
- percentage of client edits requiring operator intervention;
- publish success, rollback, and recovery time;
- premium module and transaction-component attach rate.

## 15. Immediate recommendation

Archura’s current direction already contains much of the correct Phase 1 foundation:

- tenant-scoped identity and short-lived component sessions;
- a Go system of record for sensitive operations;
- Stripe and data-connected component designs;
- embeddable web components;
- canonical artifacts and adapter-based publishing;
- an editor with constrained client-safe controls.

The next product work should connect these pieces into one complete customer journey:

1. create a tenant and plan;
2. embed signup/login/checkout;
3. create and authenticate a customer account;
4. collect payment and derive entitlements;
5. allow self-service profile, team, and billing management;
6. record the lifecycle in a customer activity view;
7. expose safe APIs and webhooks;
8. attach the first published portal or site to the same account.

That journey is narrow enough to ship, sell, and validate. It also leaves every important resource in the correct place for the Duda expansion.

## 16. Relationship to existing Archura references

- [`DUDA_PLATFORM_REFERENCE.md`](DUDA_PLATFORM_REFERENCE.md) — Duda’s platform, business model, and the longer-term capability map.
- [`archura-editor/ARCHURA.md`](archura-editor/ARCHURA.md) — editor and host responsibility boundary.
- [`docs/AUTH_ARCHITECTURE.md`](../docs/AUTH_ARCHITECTURE.md) — tenant identity and token exchange.
- [`docs/STRIPE_COMPONENT.md`](../docs/STRIPE_COMPONENT.md) — payment and data-connected component direction.
- [`docs/FINTECH_ARCHITECTURE.md`](../docs/FINTECH_ARCHITECTURE.md) — regulated system-of-record boundary.
- [`docs/DASHBOARD.md`](../docs/DASHBOARD.md) — tenant console direction.
- [`docs/FUNNEL.md`](../docs/FUNNEL.md) — anonymous-to-persistent publishing funnel.
- [`SERVICE_NODE_AND_INTERFACE_DESIGN.md`](SERVICE_NODE_AND_INTERFACE_DESIGN.md) — future agent/run/deployment architecture.

## 17. Source index

- [Outseta pricing and current product bundle](https://www.outseta.com/pricing)
- [Outseta signup, login, and profile embeds](https://go.outseta.com/support/kb/articles/By9q2qWA/integrate-outsetas-sign-up-login-and-profile-embeds)
- [Outseta profile and billing embed](https://go.outseta.com/support/kb/articles/ngWKv9pr/how-to-integrate-outsetas-profile-embed-with-your-product)
- [Duda pricing and per-site model](https://www.duda.co/pricing)
- [Duda client management](https://www.duda.co/client-management)
- [Duda white-label platform](https://www.duda.co/website-builder/white-label)

## Final decision

Build the Outseta-like layer first, but define it as **Archura’s customer, revenue, entitlement, and component control plane**. Sell it to customers whose next natural need is a managed web presence. Then add sites and simple editing, followed by fleet operations and a professional production platform.

Done this way, the company does not abandon its first product to become Duda-like. The first product becomes the foundation that makes the Duda-like company possible.
