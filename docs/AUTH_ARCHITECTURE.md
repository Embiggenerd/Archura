# Identity & Auth Architecture — B2B2C Multi-Tenant

How Archura registers **clients** (businesses) and how clients register **end-users** (their
customers), and how an embedded component authenticates a request without ever holding a
long-lived secret. This is the auth spine the fintech credit component reuses verbatim; the
Stripe component is just the first harmless resource to gate behind it.

**Status: target, staged.** Today's per-site **claim token** is a primitive tenant identity
("site" ≈ tenant). This doc defines the model to grow into. The authorization server lives
in the Go core (see `FINTECH_ARCHITECTURE.md`); the edge Worker does only coarse token
verification as a first filter.

> **Vocabulary (decided 2026-07-19): "tenant" is renamed "organization".**
> The model: `account` (a person; email + sessions) ↔ `organization` (the
> business; keys, payment config, audit, end-users, site ownership — the
> isolation boundary) via `memberships` (account_id, organization_id, role) —
> many-to-many. **Creating an account creates its default organization**;
> accounts can create more, and other accounts can be members of them. **Site
> and organization counts are unrestricted** (the earlier one-deploy-per-email
> rule is rescinded). **There is no "workspace" concept — the dashboard is
> the organization-scoped experience**, and an account merely selects which
> organization's dashboard to enter; while an account has one org,
> `/dashboard/` simply is that organization's dashboard, and an org switcher
> appears with the second membership. An agency running many
> merchants is many organizations joined by cross-org memberships — never one
> organization containing many businesses, because keys, Connect accounts,
> and liability must stay per-business.
>
> **The organization is also the billing boundary**: subscriptions, payment
> methods, and billing events attach to the organization (managed by members
> with owner/billing permission; billing events record the acting account for
> audit) — never to a person. `FUNNEL.md`'s `accounts.subscription_status` is
> superseded by this; the billing schema itself is built when FUNNEL phase 4
> (pay-to-edit) ships, not before.
>
> The doctrine in one breath: **accounts are people; organizations are
> businesses and billing boundaries; memberships decide which people can
> access and pay for an organization; the dashboard shows the currently
> selected organization; sites and embedded components belong to the
> organization.**
>
> Older text below says "tenant"; read it as organization.

## Three principals, all tenant-scoped

- **Platform admin** (Archura staff) — internal.
- **Client / tenant admin** (the business's staff) — dashboard login; configures the
  tenant, views *their* end-users, holds the tenant's API keys. → "we register clients."
- **End-user** (the client's customer) — authenticates to see *their own* data.
  → "the client registers users."

**End-user** identity is **scoped by organization**: `jane@example.com` as Client A's
customer is a different principal than as Client B's customer. Per-org token signing,
per-org validation, and an organization-id claim on every token. Isolation is enforced
at the **data layer** (row-level security, or schema/DB-per-org for the most sensitive
data), not just in application logic. **Archura account identity is the opposite —
global**: one email is one person everywhere; what differs across organizations is
their membership and role, never who they are.

## Client credentials

Registering a client mints a tenant plus two keys:

- **Publishable key** — safe in the client's frontend / the embed (`pk_`-style). Identifies
  the tenant; can do nothing sensitive on its own.
- **Secret key** — server-side only, in the client's backend. Used to mint end-user tokens
  (below). Never in the browser, never in an artifact.

The embed carries `api=` (absolute Worker/core base) + `site=`/publishable key so the
component knows which tenant it speaks for.

## The heart: ephemeral token exchange

The pattern Stripe (ephemeral keys) and Plaid (link tokens) both use. The client owns its
end-users; Archura never holds their passwords. The bridge is a short-lived scoped token:

```
End-user logs into the CLIENT's app (client's own auth)
        ↓
Client BACKEND (holds the secret key) authenticates + authorizes its own user,
then calls Archura: "mint a token for end-user X, scope Y"
        ↓
Archura core issues a SHORT-LIVED token scoped to (tenant, end-user, scope, [consent])
        ↓
Client hands that token to the embedded component (browser)
        ↓
Component calls Archura's data plane with the ephemeral token — never the secret key
        ↓
Archura core authorizes by the token's claims; tenant isolation enforced at the data layer
```

Invariants (non-negotiable, straight from how Stripe/Plaid do it):

- **The secret key never reaches the browser.** The browser only ever holds an ephemeral,
  narrowly-scoped, short-lived token.
- **The client's backend is responsible for authn + authz of its own end-user** before
  minting — Archura trusts a mint request because it is authenticated by the tenant's secret
  key, but the token it returns is bound to the specific end-user and scope the client
  asserted.
- **Every token self-describes** its tenant, principal, scope, and expiry, so the core can
  authorize precisely without a session lookup round-trip (or with one, if revocation
  matters).
- **The core is the single authorization server** — issues tokens, holds consent, enforces
  policy across all APIs. The edge only coarse-verifies.

## The one design decision

**Who owns end-user auth?**

- **Client-owned auth + token exchange (default, embedded-native).** Clients keep their own
  users and just mint scoped tokens. Archura never owns their identity or passwords. This is
  what Stripe/Plaid assume and the right default for embedding.
- **Platform-hosted end-user auth (convenience option).** For clients without their own auth,
  Archura offers hosted login / SDK widgets scoped to the tenant, and issues the same scoped
  tokens at the end.

Design the **scoped-token contract first** so both paths converge on it; the difference is
only *who authenticates the end-user before the token is minted*.

## Consent & audit (why the credit component reuses this)

The credit pull must be authorized as "this tenant's end-user, with recorded consent, for a
permissible purpose (FCRA)." That is exactly `(tenant + user + scope + consent)` — the same
token claims, plus a consent record and an audit-log entry written by the authorization
server at mint/use time. So building this identity spine (with the Stripe demo as the gated
resource) *is* building the credit component's auth, minus the provider integration.

## Namespaces & the tenant → namespace binding

How identity (core) ties to content (edge/local) — added once per-client publishing became
real. **Auth stays deliberately simple for now: claim token + platform admin key.**
Accounts/passwords attach later, if we go that route — and then they live only in core,
hashed, never at the edge.

- **One identity authority, N content stores.** A client's content lives in a
  **namespace** addressed by their slug, in whichever store the persistence adapter
  targets: R2 via the Worker (`sites/<slug>/...`) in production, the local filesystem
  (`artifacts/sites/<slug>/...`) for dev and tests. Adapters share one canonical path
  scheme and one interface — `load` / `publish` / `list(namespace)` — so the dashboard
  (and any agent driving the controller) enumerates a client's components identically
  regardless of adapter. Core never stores content; content stores never hold identity
  data.
- **The binding.** Core stores the client's actual data (name, keys, and later account
  credentials / end-user data) plus the binding: tenant → namespace slug + that
  namespace's edge credential (the claim token). Registration is **one flow**: claim
  `sites/<slug>/` at the edge, create the tenant in core, store the binding.
  (Prototype: the claim token is stored plainly in core so it can be released to
  sessions later; encrypt it before real merchants.)
- **Who reaches which namespace.** A client resolves to their own binding. Platform
  admins/devs resolve **all** bindings — access to every namespace comes from core
  knowing every binding, never from an edge-side bypass; the Worker keeps enforcing
  plain claim-token auth. Locally the FS adapter has no auth at all: a dev running it
  is implicitly admin of every local namespace, which is the intended behavior.
- **Invariants.** Edge/local stores hold nothing secret beyond token hashes; core holds
  no presentation data; the edge credential is released by core, never baked into an
  artifact or embed.
- **Identity vs. address (decided ahead of custom domains).** The slug currently does
  three jobs at once: namespace key, public address, and uniqueness token. That
  coupling ends when paying users attach full domains, and when expiry releases
  subdomains for reuse. The durable model: every site gets a permanent opaque
  **site ID** (`site_…`, minted at claim/deploy, never reused) as the true namespace
  key; hostnames — the archura subdomain now, custom domains later — become a
  **mapping to that ID**. Slug uniqueness then means only "no two active sites share
  an address." Embeds and core bindings ultimately resolve by ID, so pasted snippets
  survive renames, domain upgrades, and subdomain release. Migration is deferred
  (prototype discipline), but `meta.json` stamps `siteId` from creation so every
  namespace already carries its permanent identity — and new features must not deepen
  the slug=identity coupling.

## Seed → target migration

1. **Now:** per-site claim token (one shared secret per site). "Site" is a proto-tenant.
2. **Clients:** promote site → client/tenant with real accounts, admin login, and
   publishable/secret keys. Claim-token becomes the tenant's secret-key equivalent.
3. **End-users:** add end-user records under a tenant (or accept client-owned identities via
   token exchange).
4. **Ephemeral tokens:** the mint endpoint + scoped-token contract; embedded components stop
   using raw site tokens and use minted end-user tokens.
5. **Consent + audit:** attach to the mint/use path — the FCRA-ready version.

## Where it lives

- **Go core:** the authorization server — accounts, tenants, permissions, token issuance,
  consent, audit, tenant-isolated data. The security boundary (per
  `FINTECH_ARCHITECTURE.md`).
- **Edge Worker:** coarse token verification, routing, rate limiting. Never the final
  authorization decision; never stores or logs tokens' sensitive context.

## Reference patterns

- **Stripe ephemeral keys** — nonce in browser → server exchanges for ephemeral key with the
  secret key; the endpoint must authenticate the user has permission first.
- **Plaid link tokens** — `link_token` minted server-side with `client_id`+`secret`,
  short-lived, one-time; `public_token` exchanged server-side for the durable access token.
- **Centralized fintech authorization server** — one service issuing tokens, managing
  consent, enforcing policy across APIs, with per-tenant token isolation.

---

## Implementation plan (first cut — Worker-based) — HISTORICAL, SUPERSEDED

> **Do not implement from this section.** It predates the Go core: it builds
> the auth spine in the Worker, treats a site as the tenant, and treats the
> claim token as the organization secret — all superseded by the core-based
> reality above (accounts, organizations, memberships, core-minted keys).
> Kept for the record of how the seed model evolved.

### Guiding decisions

1. **Build in the Worker, not a Go core — yet.** We are deliberately not handling regulated
   data or real money, and our own rule (`FINTECH_ARCHITECTURE.md`) says the core is stood
   up only when that changes. So implement the spine in the Worker, but behind an
   `AuthorizationServer` module boundary (mint / verify / registerUser) so it migrates to
   the Go core later without touching callers — the same discipline as
   `ArchuraPersistenceAdapter`.
2. **Reuse the existing model: site = tenant.** The existing **claim token already IS the
   tenant's secret key** (SHA-256 hashed in `sites/<site>/meta.json`). Extend, don't rebuild.
3. **Minimal new infra: Workers KV for ephemeral tokens** (native TTL). End-users as R2 JSON
   (`sites/<site>/users/<id>.json`) for the first cut — matches the existing pattern, zero
   new relational infra; move to D1/Postgres when queries actually need to be relational.
4. **Opaque tokens in KV** (revocable, simple, TTL-native). JWT is the stateless-scale
   option, deferred.
5. **CORS + rate limiting** on every new endpoint (foreign-origin embeds call them).

### Phases (each independently verifiable)

1. **Publishable key + tenant identity.** Add a browser-safe publishable key to each site's
   meta alongside the existing secret (claim token). *Verify:* claim returns both keys; the
   publishable key identifies the tenant read-only and can do nothing sensitive.
2. **End-user registration.** `POST /api/clients/<site>/users` authed by the tenant secret →
   writes `sites/<site>/users/<id>.json`, returns the end-user id; `GET` lists them.
   *Verify:* authed create works; missing/wrong secret → 401; users are tenant-scoped.
3. **Scoped-token mint (the centerpiece).** `POST /api/tokens` authed by the tenant secret,
   body `{ endUserId, scope }` → validates the user belongs to the tenant → mints an opaque
   token stored in KV with a short TTL and value `{ tenant, endUserId, scope }` → returns it.
   *Verify:* the token resolves to the right claims; minting for a user not in the tenant is
   rejected; the token expires.
4. **Token verification + a gated resource.** `verifyToken(req)` reads the bearer token from
   KV → claims or 401. Gate a demo resource `GET /api/data/<site>/profile` that returns the
   end-user's own data only when claims match `(tenant, user, scope)`. *Verify:* valid token
   → data; wrong tenant / wrong scope / expired / missing → 401/403; **cross-tenant access
   blocked**.
5. **Data-connected component uses the token.** A component (`api`, `site`, an ephemeral
   `token`) that calls the gated resource: mock/inert in the editor, live on a published or
   embedded page. *Verify:* renders mock in the editor; on a foreign-origin page with a real
   token it fetches and displays; without a valid token it shows the error state. (This is
   Gap 1 of `STRIPE_COMPONENT.md` — the data-connected contract — realized.)

### Cross-cutting

- **Security checklist:** secrets hashed at rest; tokens short-lived + revocable; CORS
  scoped; rate-limit mint + user-creation; never log tokens or secrets.
- **Test suite** `scripts/verify-auth.mjs`: register client → register user → mint → gated
  fetch → assert cross-tenant, wrong-scope, and expiry rejections.

### Deliberately deferred

Go core, Postgres/D1, JWT, platform-hosted end-user auth, consent + audit records (the FCRA
layer), a client-admin dashboard UI (API-first for now), and KYB/KYC. Each attaches to this
spine later without reshaping it.
