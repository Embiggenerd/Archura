# Identity & Auth Architecture — B2B2C Multi-Tenant

How Archura registers **clients** (businesses) and how clients register **end-users** (their
customers), and how an embedded component authenticates a request without ever holding a
long-lived secret. This is the auth spine the fintech credit component reuses verbatim; the
Stripe component is just the first harmless resource to gate behind it.

**Status: target, staged.** Today's per-site **claim token** is a primitive tenant identity
("site" ≈ tenant). This doc defines the model to grow into. The authorization server lives
in the Go core (see `FINTECH_ARCHITECTURE.md`); the edge Worker does only coarse token
verification as a first filter.

## Three principals, all tenant-scoped

- **Platform admin** (Archura staff) — internal.
- **Client / tenant admin** (the business's staff) — dashboard login; configures the
  tenant, views *their* end-users, holds the tenant's API keys. → "we register clients."
- **End-user** (the client's customer) — authenticates to see *their own* data.
  → "the client registers users."

Identity is **scoped by tenant**: `jane@example.com` under Client A is a different principal
than under Client B. Per-tenant token signing, per-tenant validation, and a tenant-id claim
on every token. Tenant isolation is enforced at the **data layer** (row-level security, or
schema/DB-per-tenant for the most sensitive data), not just in application logic.

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

## Implementation plan (first cut — Worker-based)

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
