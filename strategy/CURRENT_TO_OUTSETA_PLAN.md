# Current Archura → Outseta-Like MVP

**Snapshot date:** July 17, 2026

**Purpose:** Dependency-ordered execution plan from the repository’s current implementation to the first sellable Outseta-like Archura product.

**Status:** Build reference. This file defines scope and gates; detailed endpoint schemas remain in the Core OpenAPI document.

**Next strategic step:** [`OUTSETA_TO_DUDA_STRATEGY.md`](OUTSETA_TO_DUDA_STRATEGY.md)

## 1. Outcome

Build a white-label customer platform that lets a tenant:

1. create and administer its Archura account;
2. connect a Stripe account;
3. define a subscription plan and the capabilities it grants;
4. install signup, login, checkout, and profile/billing components in an existing site or application;
5. acquire and authenticate a downstream customer;
6. collect payment and reconcile subscription state from Stripe webhooks;
7. grant and revoke entitlements deterministically;
8. let the customer manage profile, team, plan, payment method, and cancellation;
9. inspect an authoritative customer and activity record;
10. integrate through scoped APIs and reliable webhooks.

The MVP is complete only when this entire journey works across two isolated tenants and survives retry, webhook reordering, session expiry, and payment failure tests.

This is **not** yet a Duda-like site-production platform. It is the customer, revenue, entitlement, event, and component control plane that the future site platform will use.

## 2. Product boundary

### Included in the Outseta-like MVP

- tenant owner/operator authentication;
- tenant team invitations and a small fixed role set;
- downstream customer accounts and people;
- passwordless email authentication first;
- Stripe Connect onboarding;
- products, plans, prices, trials, and subscriptions;
- plan-derived entitlements;
- checkout and Stripe Customer Portal integration;
- signup, login, checkout, and profile/billing web components;
- transactional account and billing email;
- customer/account record and append-only activity timeline;
- tenant API credentials, component sessions, APIs, and outbound webhooks;
- a thin operator console;
- audit, observability, idempotency, rate limits, retention, and tenant isolation.

### Explicitly excluded

- marketing campaigns, newsletters, lead scoring, and complex segmentation;
- a sales CRM, deal pipeline, tasks, forecasting, and call logging;
- a help desk, shared inbox, chat widget, and knowledge-base product;
- usage-based billing, metered tiers, revenue recognition, quotes, and invoicing workflows beyond Stripe’s supported subscription lifecycle;
- support for multiple payment processors;
- marketplace or general integration catalog;
- arbitrary automation builder;
- social login beyond one proven provider;
- custom enterprise SSO/SAML;
- full site builder, domains, multipage sites, and site fleet;
- bookings, commerce catalog, inventory, and fulfillment;
- AI agents making mutations.

Deferrals are product guardrails. They should move only after the MVP is in use and a repeated customer need is demonstrated.

## 3. Initial customer and use case

### Primary buyer

A small agency, product studio, membership/service platform, or vertical SaaS company that needs customer identity, subscription billing, a self-service portal, and embeddable UI without assembling five vendors.

### Reference use case

A vertical SaaS tenant sells one monthly plan to small businesses. It embeds Archura components into its existing application. Each customer may have multiple team members. Paying customers receive named product capabilities. The tenant can see the customer, subscription, team, and activity in one console.

This use case proves the shared foundation needed later for client sites, site packages, editors, and Duda-like fleet operations.

## 4. Current implementation audit

This audit includes the working tree on July 17, 2026, not only committed `HEAD`.

### Status legend

| Status | Meaning |
|---|---|
| Implemented | Code and a verification path exist today |
| Partial | A useful seam exists, but the customer journey is incomplete |
| Designed | Documented direction without a complete implementation |
| Missing | No product implementation found |

### Core and data

| Capability | Status | Current evidence | Gap to MVP |
|---|---|---|---|
| Go Core service | Implemented | Health/readiness, configuration validation, migrations, structured errors, OpenAPI/Swagger | Extend domain and APIs without weakening the security boundary |
| PostgreSQL migrations | Implemented | `0001`–`0005` cover tenants, API keys, payment components, component sessions, audit, rate limits, namespace binding | Add people, memberships, customer accounts, auth sessions, billing, entitlements, events, webhooks, and email records |
| Tenant creation | Implemented | `POST /v1/clients` creates a tenant and one-time publishable/secret credentials | Add tenant owner identity and durable operator session; normalize “client” terminology |
| Tenant machine authentication | Implemented | Hashed `sk_` secret lookup and environment-specific key types | Keep for server-to-server use; never use it as dashboard/browser authentication |
| Payment-component configuration | Implemented | Tenant-owned `payment_components` with mode, Stripe Price ID, redirects, origin policy, status | Bind to connected Stripe account and first-class plan/price records |
| Component sessions | Implemented | Opaque hashed ten-minute `ct_` token bound to tenant, component, audience, scope, and origin | Add authenticated person/customer context and additional narrow audiences/scopes |
| Audit log | Partial | Transactional audit rows for tenant/component/session writes | Expand actor/resource/action model; current database `CHECK` lists do not scale to the MVP event vocabulary |
| Rate limiting | Implemented | PostgreSQL fixed-window buckets plus edge coarse limiter | Define per-person, tenant, auth, checkout, and webhook limits |
| Maintenance | Partial | Deletes expired component sessions and rate buckets | Add auth sessions, verification tokens, webhook attempts, idempotency, and retention policies |
| Observability | Implemented foundation | Structured access/security logs and Prometheus metrics | Add auth, checkout, subscription, webhook, email, entitlement, and component outcome metrics |

### Edge, artifacts, and publishing

| Capability | Status | Current evidence | Gap to MVP |
|---|---|---|---|
| Core proxy | Implemented | Worker strips caller-controlled service/IP headers and adds its own service credential | Extend route-aware rate-limit categories and preserve safe error contracts |
| Namespace claim/publish | Implemented foundation | Per-site claim token, R2 artifacts/assets/embeds, namespace listing | Consolidate tenant↔namespace authority in Core; current claim identity is not an operator/customer account |
| Artifact persistence | Implemented | Filesystem and R2 adapters share load/publish contract | Not on the critical path for Phase 1 customer lifecycle |
| Per-client embed publishing | Implemented | Generated JS modules, CORS serving, tenant-specific styles/traits | Reuse delivery mechanism for lifecycle components after auth/action contracts exist |
| Published site serving | Implemented single-page foundation | Subdomain/path routing, canonical artifact shell, live refresh | Defer site expansion until after the Outseta-like MVP |

### Editor and component system

| Capability | Status | Current evidence | Gap to MVP |
|---|---|---|---|
| Constrained visual editor | Implemented foundation | Component registry, traits, custom-property styling, parts, themes, responsive modes, canonical artifact | Lifecycle components must declare safe editable content/design without exposing security configuration |
| Component packaging | Implemented foundation | Production build emits six standalone component modules | Publish/version lifecycle is still repository/build oriented rather than a platform registry |
| Stripe component UI | Partial | Styled preview/live Stripe Elements seam; emits `archura:pay` | No server checkout action, client secret, payment confirmation orchestration, or authoritative result |
| General data-connected action contract | Designed/partial | `api`, tenant key, session token, scoped component session design | Standardize request/result/error/events for every authenticated component |
| Signup/login/profile components | Missing | No implementation found | Build after person/customer auth APIs are stable |

### Product surfaces

| Capability | Status | Current evidence | Gap to MVP |
|---|---|---|---|
| Tenant console | Designed | `DASHBOARD.md` defines a thin future console | Requires operator authentication and new account/billing/customer APIs |
| End-customer portal | Missing | No implementation found | Provide profile/team/plan/billing surfaces, preferably from the same component package |
| Email confirmation funnel | Designed | `FUNNEL.md` specifies magic-link ownership for sites | Extract reusable verification/session primitives before coupling them to sites |
| Plans/subscriptions/entitlements | Missing | Stripe Price ID is stored, but no authoritative subscription lifecycle exists | Central MVP domain |
| Customer record/activity | Missing | Only tenant/component audit exists | Add downstream account/person view and product activity events |
| Transactional email | Missing | Provider choice appears only in design docs | Add outbox-backed provider adapter and delivery state |
| Outbound tenant webhooks | Missing | No endpoint/delivery store found | Add signed, retried, observable deliveries |

### Verification snapshot

| Check | Result on July 17, 2026 | Interpretation |
|---|---|---|
| `core: go test ./...` | Pass | Core unit tests are green; database integration tests still require `TEST_DATABASE_URL` |
| `archura-editor: npm run build` | Pass | Vite app and six component modules build successfully |
| `archura-editor: npm run typecheck` | Fail | Lit `css`/`unsafeCSS` export resolution and one implicit-`any` error must be fixed in Milestone 0 |
| `archura-editor: npm run verify:all` | Environment-blocked | Sandbox denied local `::1:5199` listener with `EPERM`; no suite result was obtained in this audit |

Do not mark Milestone 0 complete from the build alone. Type checking and the full verification suite must both be green in an environment that permits local test servers.

## 5. Target resource model

### Ownership hierarchy

```text
Archura platform
└── Tenant                          buyer/operator boundary
    ├── TenantMembership           tenant staff access
    │   └── Person                 authenticated human identity
    ├── ConnectedStripeAccount     tenant's payment provider connection
    ├── Product / Plan / Price     tenant's commercial offer
    │   └── PlanEntitlement        capabilities included in the plan
    ├── CustomerAccount            downstream billing/team boundary
    │   ├── CustomerMembership     people belonging to the customer account
    │   │   └── Person
    │   ├── Subscription
    │   └── EffectiveEntitlement
    ├── Component                  configured embeddable surface
    │   └── ComponentSession       short-lived action authority
    ├── CustomerEvent              activity timeline
    ├── WebhookEndpoint / Delivery
    └── EmailMessage
```

### Resource definitions

| Resource | Purpose | Key decisions |
|---|---|---|
| `tenants` | Archura’s paying organization | Keep existing IDs and rows; this remains the isolation root |
| `people` | One human identity | Normalize email for lookup; do not make email the primary key; support membership in multiple tenants/accounts |
| `person_identities` | Login methods and verification state | Start with email magic link; store token hashes only |
| `tenant_memberships` | Operator access to one tenant | Fixed roles: `owner`, `admin`, `support`, `viewer` |
| `operator_sessions` | Browser console session | Opaque, hashed, revocable, rotating, bounded lifetime; secure HttpOnly cookie |
| `customer_accounts` | Downstream billing and team boundary | Belongs to exactly one tenant; optional display name and external reference |
| `customer_memberships` | A person’s access to a customer account | Fixed roles: `owner`, `admin`, `member`; tenant-scoped unique membership |
| `customer_sessions` | Downstream app/component login | Tenant, person, customer account, audience, scopes, expiry, revocation |
| `connected_stripe_accounts` | Stripe Connect state | Store account ID and capability/status metadata, never reusable provider secrets in browser state |
| `products` | Tenant’s sellable product | Minimal name/status metadata |
| `plans` | Entitlement bundle and lifecycle policy | Active/inactive; trial policy; stable internal ID |
| `prices` | Stripe-linked commercial amount/interval | Store Stripe Price ID plus immutable amount/currency/interval snapshot |
| `plan_entitlements` | Named capabilities a plan grants | Capability string plus optional bounded value; no product-specific booleans on customer rows |
| `subscriptions` | Authoritative local projection of Stripe subscription | Stripe IDs, customer account, plan/price, status, periods, cancellation, version/timestamps |
| `effective_entitlements` | Queryable derived grants | Derived from active subscription plus explicit grants; record source and expiry |
| `payment_components` | Tenant-configured checkout surface | Preserve existing IDs; add plan/price reference and connected-account binding |
| `component_sessions` | Narrow browser authority | Preserve opaque-token model; add person/customer account where the action requires them |
| `customer_events` | Product/customer activity timeline | Append-only, tenant/customer scoped, typed, allowlisted metadata, correlation ID |
| `idempotency_records` | Safe mutation retries | Tenant + operation + key uniqueness, request fingerprint, stored result/status |
| `webhook_events` | Inbound Stripe event receipt | Unique provider event ID, payload reference/hash, processing state, attempts |
| `webhook_endpoints` | Tenant callback configuration | HTTPS endpoint, event filters, encrypted signing secret, status |
| `webhook_deliveries` | Outbound delivery attempts | Event, endpoint, attempt, response class, next attempt, terminal state |
| `email_messages` | Transactional email outbox/delivery | Template, recipient identity, provider ID, state, attempts; no marketing model |

### Data-model rules

1. Every tenant-owned row carries `tenant_id`, even when it can be derived through a parent. This makes authorization review and operational queries explicit.
2. Cross-tenant unique constraints include `tenant_id` unless the value is globally owned by Archura.
3. Provider IDs are references, not primary identities.
4. Money is stored in integer minor units with ISO currency.
5. Timestamps are UTC and lifecycle transitions record both effective time and receipt time where webhooks are involved.
6. Soft state such as a Stripe subscription projection is rebuildable from provider events and reconciliation.
7. Access decisions use effective entitlements, not browser claims or cached checkout success pages.
8. Audit/event metadata is allowlisted and must not contain credentials, payment details, raw tokens, or unnecessary personal data.

## 6. Terminology and migration from today

### Keep

- `tenants` as the organization/isolation root;
- existing tenant UUIDs, slugs, status, origins, and API keys;
- `pk_`, `sk_`, `svc_`, `cmp_`, `ses_`, and `ct_` credential/ID formats where their meanings remain valid;
- existing `payment_components` and `component_sessions` rows;
- Core as the authority for identity, money, permissions, and audit;
- Worker as a coarse edge/proxy and artifact delivery layer;
- canonical artifacts and host/adaptor boundaries;
- the constrained component editing contract.

### Change deliberately

| Current concept | Target treatment |
|---|---|
| `/v1/clients` means tenant creation | Introduce `/v1/tenants`; retain `/v1/clients` as a temporary compatibility alias, then deprecate |
| Tenant secret used for all management | Keep for server-to-server API; add operator login/session for the console |
| `external_user_id` on component session | Preserve during migration; prefer first-class `person_id` and `customer_account_id` once customer auth lands |
| Payment component points directly at Stripe Price ID | Add internal `price_id`/`plan_id`; retain Stripe ID as provider mapping and migration input |
| Claim token is site authority at the edge | Bind namespace credentials to tenant in Core and rotate/revoke through Core; never turn claim token into user auth |
| Audit action/resource `CHECK` lists | Migrate to extensible typed strings or reference tables so each new domain action does not require fragile table recreation |
| “Account” used ambiguously | Use `tenant` for Archura buyer and `customer_account` for the tenant’s downstream billing/team unit |

### Migration order

1. Add new tables without changing existing write paths.
2. Add tenant owner/person/membership records for existing tenants through an explicit claim/invite flow; do not synthesize unknown email owners.
3. Add operator sessions and move the future console off tenant secrets.
4. Add internal products/plans/prices, then backfill a price mapping from each existing payment component’s Stripe Price ID when a connected Stripe account is known.
5. Extend component sessions with nullable first-class actor/customer references; keep `external_user_id` during compatibility window.
6. Dual-write new customer/audit events during one release before making timeline APIs depend on them.
7. Move tenant↔edge namespace management behind Core while accepting existing valid claim tokens until rotated.
8. Remove compatibility fields/endpoints only after usage metrics show no active callers.

Every migration needs an `.up.sql`, `.down.sql`, store test, OpenAPI update when applicable, and a test proving tenant isolation.

## 7. Authentication and authorization model

### Four credential classes

| Credential | Holder | Purpose | Must not do |
|---|---|---|---|
| Platform service/admin | Archura infrastructure/operators | Tenant onboarding and internal operations | Appear in tenant applications or browsers |
| Tenant API secret | Tenant backend | Server-to-server tenant management and session minting | Authenticate a human browser session |
| Operator/customer session | Human browser | Console or downstream customer portal | Act outside the person’s memberships and entitlements |
| Component session | Embedded component | One narrow action/audience/origin for a short period | Become a general user session or contain reusable provider credentials |

### Authorization inputs

Every protected decision should resolve:

- authenticated credential class;
- tenant;
- person, if human;
- tenant or customer membership;
- resource ownership;
- required role;
- required entitlement;
- action scope and audience;
- request origin where the browser is involved;
- resource status/version;
- idempotency key for mutation retries.

### MVP session decisions

- Passwordless email magic links first.
- Operator console session uses a secure, HttpOnly, SameSite cookie.
- Embedded/downstream flows exchange a verified login result for a tenant- and audience-bound customer session.
- Sensitive account changes require recent authentication.
- Session rows store token hashes, expiry, revocation, last-used metadata, and creation context.
- Logout revokes the current session; password/email/security changes revoke the appropriate session family.
- Browser-facing responses containing tokens use `Cache-Control: no-store`.

## 8. Billing and entitlement model

### Stripe boundary

Use Stripe Connect so each tenant can sell to its own customers. The Core stores the connected-account relationship and invokes Stripe server-side. The browser receives only Stripe publishable configuration and one-time client secrets appropriate to the action.

The exact charge type and application-fee model must be selected before Milestone 3 implementation. The MVP must use one model consistently; do not support every Connect charge pattern.

### Source-of-truth rule

Stripe is authoritative for processor-side payment/subscription state. Core is authoritative for Archura resource ownership, authorization, and the local reconciled projection used by components and applications.

Checkout success redirect is not proof of entitlement. Entitlements change only after an authenticated server action plus authoritative webhook/reconciliation state.

### Minimal subscription states

Use Stripe’s lifecycle as input but expose a small internal policy state:

- `pending`;
- `trialing`;
- `active`;
- `past_due`;
- `paused` if supported by the chosen flow;
- `canceled`;
- `incomplete_expired`.

Policy must state which states grant each entitlement and whether a grace period exists. Avoid scattering these decisions across components.

### Webhook processing invariants

- Verify Stripe signature against the correct connected/platform context.
- Store provider event ID before processing; duplicates return success without duplicate effects.
- Process in a transaction where local state and outbox events must agree.
- Compare provider object version/effective timestamps so stale events do not regress state.
- Queue reconciliation when order is ambiguous or a dependency is missing.
- Never send tenant webhooks or email inside the database transaction; write outbox records.
- Expose retry/terminal metrics and an operator replay path.

## 9. Minimal API surface

The names below define resource coverage, not final payloads. Add operations to `core/internal/api/openapi.json` with route-drift tests as each milestone lands.

### Operator identity

- `POST /v1/auth/magic-links`
- `POST /v1/auth/magic-links/verify`
- `POST /v1/auth/logout`
- `GET /v1/session`
- `GET /v1/tenant`
- `GET|POST /v1/tenant/members`
- `DELETE /v1/tenant/members/{membershipID}`
- `POST /v1/tenant/invitations`

### Downstream customers

- `POST /v1/customer-auth/signup`
- `POST /v1/customer-auth/magic-links`
- `POST /v1/customer-auth/magic-links/verify`
- `POST /v1/customer-auth/logout`
- `GET /v1/customer-session`
- `GET|POST /v1/customer-accounts`
- `GET|PATCH /v1/customer-accounts/{accountID}`
- `GET|POST /v1/customer-accounts/{accountID}/members`
- `DELETE /v1/customer-accounts/{accountID}/members/{membershipID}`

### Catalog and billing

- `POST /v1/stripe/connect-links`
- `GET /v1/stripe/account`
- `GET|POST /v1/products`
- `GET|POST /v1/plans`
- `GET|POST /v1/prices`
- `GET|PUT /v1/plans/{planID}/entitlements`
- `POST /v1/checkout-sessions`
- `POST /v1/billing-portal-sessions`
- `GET /v1/customer-accounts/{accountID}/subscription`
- `GET /v1/customer-accounts/{accountID}/entitlements`
- `POST /v1/webhooks/stripe`

### Components

- keep `POST /v1/components` and `PUT /v1/components/{componentID}` during migration;
- extend `POST /v1/component-sessions` to select a declared component action;
- do not add generic `execute` authority; each action has a named Core route and required scope;
- add public component bootstrap/config only when it contains no secret or tenant-private state.

### Activity, integrations, and email

- `GET /v1/customer-accounts/{accountID}/events`
- `GET|POST /v1/webhook-endpoints`
- `DELETE /v1/webhook-endpoints/{endpointID}`
- `GET /v1/webhook-deliveries`
- `POST /v1/webhook-deliveries/{deliveryID}/retry`
- `GET /v1/email-messages`

## 10. Event vocabulary

Use stable past-tense names. Initial events:

- `tenant.created`;
- `tenant.member_invited`;
- `tenant.member_joined`;
- `person.email_verified`;
- `customer_account.created`;
- `customer_member_invited`;
- `customer_member_joined`;
- `stripe_account.connected`;
- `plan.created`;
- `checkout.started`;
- `checkout.completed`;
- `subscription.created`;
- `subscription.updated`;
- `subscription.canceled`;
- `payment.failed`;
- `entitlements.changed`;
- `profile.updated`;
- `component_session.created`;
- `webhook.delivery_succeeded`;
- `webhook.delivery_failed`.

Not every internal audit event should be delivered to tenants. Maintain explicit allowlists for customer timeline, audit, outbound webhook, and metrics consumers.

## 11. Dependency-ordered milestones

### Milestone 0 — Restore and freeze the baseline

**Goal:** Begin domain expansion from a trustworthy repository state.

Work:

- fix the current `npm run typecheck` failures without changing the editor’s public behavior;
- run `npm run verify:all` in an environment permitting local Vite/Wrangler listeners;
- run Core tests with and without `TEST_DATABASE_URL` where available;
- capture current OpenAPI, migration, Worker route, artifact, and component-session contracts;
- add a short current-state verification record to this file or CI output;
- decide whether current uncommitted namespace/client-styling work is accepted before building on it.

Exit gate:

- Core unit and migration tests pass;
- editor build, typecheck, and verification suites pass;
- no undocumented route drift;
- no existing cross-tenant isolation regression.

### Milestone 1 — Operator identity and tenant administration

**Goal:** A tenant owner can log in to a browser console without using `sk_`.

Data:

- `people`, `person_identities`, `tenant_memberships`, `operator_sessions`, `invitations`, verification tokens.

Core:

- passwordless request/verify/logout/session APIs;
- owner/admin/support/viewer authorization middleware;
- invite, accept, list, and remove tenant members;
- rate limiting and non-enumerating auth responses;
- transactional audit and security events.

UI:

- login, magic-link confirmation, tenant overview, and team screen;
- tenant secret is never placed in browser storage.

Verify:

- the same person may belong to two tenants and sees only the selected tenant;
- a viewer cannot invite or remove members;
- expired, replayed, and cross-environment links fail;
- removing a member revokes their tenant console sessions;
- email lookup does not reveal whether an account exists.

### Milestone 2 — Downstream customer accounts and authentication

**Goal:** A tenant can register and authenticate its own customers and customer teams.

Data:

- `customer_accounts`, `customer_memberships`, `customer_sessions`.

Core:

- tenant-configurable signup policy: open or invite-only;
- create account, verify email, login, logout, session, profile, invite/remove team member;
- role checks for customer owner/admin/member;
- external customer reference uniqueness within tenant.

Component contract:

- define auth result, error codes, redirects, and emitted DOM events;
- keep authentication separate from visual styling and editable text.

Verify:

- identical emails can participate in different tenants without data leakage;
- one person can belong to multiple downstream customer accounts;
- customer sessions cannot call operator endpoints;
- customer owner removal/transfer rules cannot orphan an account;
- origin and audience restrictions hold for embedded login.

### Milestone 3 — Stripe Connect and minimal catalog

**Goal:** A tenant connects Stripe and creates one sellable recurring plan.

Decision gate before code:

- choose Connect account type and one charge/application-fee pattern;
- decide who is merchant of record and document support/compliance consequences;
- decide whether Archura creates Stripe Products/Prices or imports existing immutable Prices.

Data:

- `connected_stripe_accounts`, `products`, `plans`, `prices`, `plan_entitlements`.

Core/UI:

- Connect onboarding/account-link flow and status refresh;
- create/list/disable product, plan, and price;
- define entitlement names and bounded values;
- block checkout configuration until required Stripe capabilities are active.

Verify:

- Stripe account A can never be used by tenant B;
- return/refresh URLs are bound and validated;
- prices are immutable after activation; replacement creates a new price;
- disconnect/deauthorization blocks new checkout without destroying historical records.

### Milestone 4 — Checkout, webhooks, subscriptions, and entitlements

**Goal:** Payment changes authoritative local subscription and capability state.

Data:

- `subscriptions`, `effective_entitlements`, `webhook_events`, `idempotency_records`, outbox records.

Core:

- create checkout session from server-stored tenant/plan/price configuration;
- Stripe webhook signature verification and idempotent event receipt;
- subscription projection and reconciliation;
- deterministic entitlement calculation;
- billing portal session creation;
- customer subscription/entitlement read APIs.

Verify:

- duplicate checkout requests with one idempotency key create one logical checkout;
- duplicate and out-of-order webhooks do not duplicate or regress state;
- success redirect before webhook does not grant entitlement;
- cancellation, failed payment, recovery, and trial transitions follow one documented policy;
- reconciliation repairs a deliberately missed event;
- no card data or provider secret reaches Core logs, audit, or artifacts.

### Milestone 5 — Lifecycle web components

**Goal:** A customer completes the lifecycle from an arbitrary host application.

Components:

- `<archura-signup>`;
- `<archura-login>`;
- `<archura-checkout>` or the migrated `<archura-stripe-payment>`;
- `<archura-profile>` with profile, team, plan, and billing sections.

Shared contract:

- explicit bootstrap/config schema;
- scoped session exchange;
- consistent loading, success, empty, expired, and error states;
- typed DOM events;
- safe redirect validation;
- theme/custom-property contract;
- accessibility keyboard/focus/error behavior;
- no tenant secret, Stripe secret, entitlement authority, or sensitive cached data in the component.

Editor:

- components may expose layout, labels, safe content, and style traits;
- component IDs, API endpoints, plan references, and security configuration are operator-owned and locked from client editing.

Verify:

- the same component modules work standalone and on an Archura-published artifact;
- two tenants render different branding/config without cross-tenant state;
- expired component and customer sessions recover safely;
- login/signup/checkout/profile flows pass mobile and accessibility checks;
- malicious attributes cannot redirect to an unapproved origin or select another tenant’s plan.

### Milestone 6 — Customer activity, tenant webhooks, and transactional email

**Goal:** The platform is operable and integrable without becoming a marketing suite.

Data/services:

- `customer_events`, `webhook_endpoints`, `webhook_deliveries`, `email_messages`;
- transactional outbox worker;
- one email provider adapter;
- signed outbound webhook delivery with exponential retry and terminal state.

UI:

- customer/account detail with team, plan, subscription, entitlements, and activity;
- webhook endpoint and delivery inspection;
- email delivery status.

Verify:

- database state and outbox record commit atomically;
- provider outage does not lose an email/webhook;
- webhook signatures, timestamps, replay guidance, and secret rotation work;
- payloads are tenant-scoped and contain only documented fields;
- retries do not repeat internal business effects;
- personal-data retention/deletion behavior is documented and tested.

### Milestone 7 — Thin operator console and self-service portal

**Goal:** A non-developer can operate the MVP without API calls.

Operator console screens:

1. login;
2. account/team;
3. Stripe connection;
4. products/plans/entitlements;
5. component configuration and install snippet;
6. customer list and customer detail/activity;
7. webhook/email delivery diagnostics;
8. API key rotation/revocation.

Customer portal surfaces:

- profile;
- customer account/team;
- current plan and entitlements;
- billing portal launch;
- logout and security/session controls.

Rules:

- console uses operator session, never `sk_` in browser;
- customer portal uses customer session, never a tenant credential;
- secrets are returned only at creation/rotation and never listed;
- destructive actions require explicit confirmation and recent authentication where appropriate.

Verify:

- complete reference journey requires no direct API tooling;
- every screen enforces server-side authorization;
- a browser-storage inspection finds no reusable tenant/provider secret;
- audit and customer activity reflect all material UI actions.

### Milestone 8 — Pilot and production hardening

**Goal:** Validate the product with real target customers before site-platform expansion.

Operational work:

- deploy Core, Worker, database, queue/scheduler, and email path with backups and restore drill;
- production Stripe test/live separation and webhook configuration;
- alerting for auth abuse, webhook backlog, subscription drift, email failure, and checkout failure;
- data export and constrained deletion workflow;
- incident and support runbooks;
- API/component versioning and deprecation policy;
- tenant onboarding and integration guide;
- privacy, terms, payment-role, and subprocessor review.

Pilot:

- 3–5 design partners from the preferred customer segments;
- at least two different host stacks;
- at least one multi-member customer account;
- real recurring subscriptions in live mode;
- weekly review of integration friction and requested adjacent features.

Exit gate:

- zero known cross-tenant or entitlement-authority defects;
- checkout→webhook→subscription→entitlement completes reliably;
- webhook/email backlog recovers after forced provider outage;
- restore drill meets the documented recovery target;
- customers complete setup without direct database/manual intervention;
- repeated demand supports adding managed sites rather than expanding into generic CRM/help-desk/email features.

## 12. Cross-milestone verification matrix

| Concern | Required verification |
|---|---|
| Tenant isolation | Every repository query and API fixture includes two tenants and a cross-tenant denial case |
| Authentication | Expiry, replay, revocation, enumeration, fixation, cookie flags, audience, and origin tests |
| Authorization | Role × resource × action matrix for operator and customer principals |
| Billing | Stripe test clocks/fixtures where possible; duplicate/out-of-order/missed event tests |
| Entitlements | Table-driven lifecycle policy tests independent of HTTP handlers |
| Idempotency | Same key/same request, same key/different request, concurrent retry tests |
| Components | Standalone, editor preview, published artifact, foreign-origin embed, mobile, accessibility |
| Audit/events | Material mutation creates correct actor/resource/correlation metadata without secrets/PII leakage |
| Webhooks/email | Signing, retry, poison delivery, outage recovery, terminal state, replay |
| Migrations | Clean install, upgrade from current schema, rollback where safe, constraint/isolation tests |
| Operations | Metrics, structured errors/logs, backup/restore, maintenance retention, runbooks |

## 13. File and service ownership

| Concern | Owner |
|---|---|
| People, memberships, sessions, plans, subscriptions, entitlements | `core/` |
| Stripe secret operations, webhook reconciliation, audit | `core/` |
| Coarse abuse limits, trusted service proxy, CORS, artifact/embed delivery | `archura-editor/workers/site-worker.js` or a later split Worker |
| Lifecycle web components and visual contracts | `archura-editor/src/components/` |
| Component manifests/editor integration | `archura-editor/src/editor/` and registry |
| Operator console/customer portal | New product UI package or app; do not bury it inside the editor controller |
| Transactional jobs | Core-owned outbox processor or separate worker using Core records |
| Public contract | Core OpenAPI plus versioned component manifest/event documentation |

Do not make the Cloudflare Worker a second identity, subscription, or entitlement database. Do not make the editor controller responsible for operator/customer application state.

## 14. Decisions required before implementation

Only the first four block early milestones; the rest block their named milestone.

1. **Tenant owner bootstrap:** invitation-only platform onboarding or verified email claim for existing tenants? Blocks Milestone 1.
2. **Person scope:** global person identity with tenant memberships, as proposed, or duplicate people per tenant? Blocks Milestone 1. Recommendation: global identity, tenant-scoped memberships and data.
3. **Customer signup policy:** open, invite-only, or both? Blocks Milestone 2. Recommendation: both, configured per tenant.
4. **Session delivery:** secure same-site cookie for first-party console plus token exchange for foreign-origin embeds? Blocks Milestones 1–2. Recommendation: yes.
5. **Stripe Connect model and merchant-of-record boundary:** blocks Milestone 3 and must receive legal/accounting review.
6. **Product catalog ownership:** Archura-created Stripe prices or imported prices? Blocks Milestone 3. Recommendation: choose one for MVP, not both.
7. **Past-due grace policy:** blocks entitlement rules in Milestone 4.
8. **Existing `archura-stripe-payment` migration:** evolve tag compatibly or introduce `archura-checkout` and deprecate? Blocks Milestone 5.
9. **Email provider:** choose one transactional provider and one region/data-processing posture. Blocks Milestone 6.
10. **Console package/location:** choose after auth APIs stabilize; keep it separate from the editor engine. Blocks Milestone 7.

## 15. Pilot metrics

### Activation

- time from tenant creation to connected Stripe account;
- time to first plan;
- time to first installed component;
- time to first verified customer and first successful subscription;
- percentage of tenants completing setup without support.

### Reliability

- authentication success/failure by reason;
- checkout creation and completion rate;
- webhook processing latency, retry rate, and terminal failures;
- subscription reconciliation drift;
- entitlement propagation latency;
- transactional email delivery/failure rate;
- component API error rate by version and host origin.

### Product fit

- active downstream customer accounts per tenant;
- multi-member customer-account rate;
- profile/billing self-service completion rate;
- API and webhook adoption;
- support requests per active tenant;
- requests for sites, portals, content, domains, white label, and multi-client management;
- requests for excluded CRM/email/help-desk features, tracked without automatically accepting them.

## 16. Definition of the Outseta-like MVP

The MVP is achieved when all of the following are true:

- tenant operators use human sessions and roles rather than API secrets in the browser;
- downstream people and customer accounts are first-class, tenant-isolated resources;
- a tenant connects Stripe and offers a real recurring plan;
- subscriptions reconcile idempotently from Stripe;
- effective entitlements are server-authoritative and lifecycle-tested;
- signup, login, checkout, and profile/billing components work on external host sites;
- customers can manage their team and billing without tenant intervention;
- operators can inspect customers, subscriptions, entitlements, events, and delivery failures;
- tenant webhooks and transactional emails retry safely;
- Core tests, editor typecheck/build, component/browser suites, and migration tests are green;
- backup/restore and provider-outage recovery have been exercised;
- at least three design partners complete the journey in production;
- no generic CRM, help desk, or marketing suite was required to produce customer value.

## 17. Transition after MVP

After the evidence gates are met, the next expansion is not “more Outseta.” It is the first managed web-presence layer:

1. first-class `Site`, `Page`, `Template`, `Theme`, `ContentRecord`, `ArtifactVersion`, and `PublishRecord` resources;
2. attach sites to the existing tenant/customer/person/plan/entitlement model;
3. provision a site from a template using existing customer/business data;
4. expose a constrained Simple/Client editor;
5. price active sites as an expansion unit;
6. grow toward white-label fleet operations using [`DUDA_PLATFORM_REFERENCE.md`](DUDA_PLATFORM_REFERENCE.md).

## 18. Related references

- [`OUTSETA_TO_DUDA_STRATEGY.md`](OUTSETA_TO_DUDA_STRATEGY.md) — company and product progression.
- [`DUDA_PLATFORM_REFERENCE.md`](DUDA_PLATFORM_REFERENCE.md) — longer-term platform model.
- [`archura-editor/ARCHURA.md`](archura-editor/ARCHURA.md) — editor package boundary.
- [`docs/AUTH_ARCHITECTURE.md`](../docs/AUTH_ARCHITECTURE.md) — current B2B2C identity direction.
- [`docs/CORE_SERVER.md`](../docs/CORE_SERVER.md) — Core design reference.
- [`core/README.md`](core/README.md) — implemented Core operations and API summary.
- [`docs/STRIPE_COMPONENT.md`](../docs/STRIPE_COMPONENT.md) — payment/data-connected component path.
- [`docs/DASHBOARD.md`](../docs/DASHBOARD.md) — thin console direction.
- [`docs/FUNNEL.md`](../docs/FUNNEL.md) — site acquisition/publishing funnel to revisit after MVP.
- [`docs/FINTECH_ARCHITECTURE.md`](../docs/FINTECH_ARCHITECTURE.md) — regulated boundary.

## Final recommendation

Start with Milestone 0, then build operator identity before adding more payment UI. The current repository already proves machine credentials, scoped component sessions, tenant-owned configuration, audit, edge/core separation, embeddable components, and publishing. The missing value is the human and commercial lifecycle connecting those pieces.

The shortest defensible path is:

```text
green baseline
→ operator identity
→ downstream customer identity
→ one Stripe Connect/catalog model
→ subscription + entitlement authority
→ lifecycle components
→ events/email/webhooks
→ thin console
→ design-partner validation
```

Do not begin managed sites or broaden into CRM/help-desk/email marketing until this journey is reliable and customers demonstrate which expansion they will pay for.
