# Archura Core Server (Go) — Design & Build Reference

The regulated system-of-record and authorization server, written in Go. Sits behind the
Cloudflare Worker edge (per `FINTECH_ARCHITECTURE.md`) and owns identity, client onboarding,
the scoped-token spine (`AUTH_ARCHITECTURE.md`), and the Stripe payment backend
(`STRIPE_COMPONENT.md`).

**This sprint's goal:** onboard clients (tenants) + issue the auth spine + a customizable
Stripe component that creates real Checkout sessions (Stripe **test mode**). Ledger,
balances, and the credit/FCRA layer are deferred but the schema leaves room for them.

**Note on staging:** earlier docs said "don't stand up the core until regulated data exists."
This sprint deliberately pulls it forward — the tradeoff is ops burden earlier in exchange
for a durable Go foundation instead of throwaway Worker auth. Accepted.

## Where it sits

```
Client / embed
   ↓  TLS
Cloudflare Worker  — edge: routing, rate limiting, CORS, coarse checks, static assets
   ↓  HTTPS + signed service token (Worker→core; core still authorizes independently)
Go Core  — the security boundary
   ├── tenants (clients) + API keys
   ├── end-users (per tenant)
   ├── scoped ephemeral tokens (mint + verify)
   ├── Stripe: per-tenant config, Checkout sessions, webhooks
   ├── audit log
   └── Postgres (primary relational DB)
```

The Worker is transport + first filter; the core independently authorizes every request by
the end-user token. The edge never makes the final authorization decision.

## Tech stack (opinionated, justified)

- **Language:** Go (1.22+).
- **HTTP:** `chi` router (light, mature, good middleware) over stdlib `net/http`. No heavy
  framework.
- **DB:** PostgreSQL. Driver `pgx`; type-safe queries via `sqlc` (added in M1 when real
  queries exist). Migrations: a small transactional embedded runner (`store.Migrate`,
  filename-ordered `internal/store/migrations/*.up.sql`) — swapped for `golang-migrate` only
  if branching/rollback needs grow. Tenant isolation: every query scoped by `tenant_id`
  through a shared helper; add Postgres **row-level security** as hardening.
- **Tokens:** opaque, `crypto/rand`, stored **hashed** in Postgres with `(tenant_id,
  end_user_id, scope, expires_at, revoked_at)`. Revocable and auditable. JWT is the
  stateless-scale option, deferred.
- **API-key secrets:** high-entropy random, shown once, stored as SHA-256 hash (same model as
  today's claim tokens, and as Stripe's `sk_`).
- **Stripe:** official `stripe-go` SDK. Test keys throughout this sprint.
- **Secrets at rest:** tenant Stripe keys encrypted with app-level AES-GCM using a master key
  from the platform secret store (later: KMS). Never logged.
- **Config:** env vars into a typed `Config` struct (12-factor).
- **Observability:** `slog` structured logging with request IDs; a dedicated append-only
  `audit_log` table for regulated-data access.
- **Testing:** Go `testing` + `testcontainers-go` (real Postgres) for the data layer; an
  end-to-end suite driving register→mint→checkout in Stripe test mode.

## Hosting

- **Core:** a container (Docker) on a global app platform — **Fly.io** is the natural pairing
  with Cloudflare edge (simple, global, Postgres available); Railway/Render or Cloudflare
  Containers are alternatives. Migrations run on deploy; `/healthz` for liveness.
- **Postgres:** managed — **Neon** (serverless, pairs well, and Cloudflare **Hyperdrive** can
  pool to it) or Fly Postgres.
- Secrets via the platform's secret store, injected as env.

## Data model (this sprint)

- `tenants` — id, name, slug (≈ today's "site"), created_at, status.
- `tenant_api_keys` — tenant_id, publishable_key, secret_key_hash, created_at, revoked_at.
- `end_users` — id, tenant_id, external_ref (the client's own user id), created_at.
- `tokens` — token_hash, tenant_id, end_user_id, scope, expires_at, revoked_at.
- `stripe_configs` — tenant_id, encrypted Stripe key / connected-account id, mode.
- `payments` — id, tenant_id, end_user_id?, stripe_session_id, status, amount, currency,
  created_at (source of payment state; reconciled from webhooks).
- `audit_log` — actor, tenant_id, action, resource, purpose, at (append-only).
- *Deferred (schema-reserved):* `accounts`, `ledger_entries` (double-entry), `consents`.

## API surface (called by the Worker; all tenant-scoped)

- **Platform admin** (platform-admin key): `POST /clients` (create tenant → returns
  publishable + secret key, secret shown once), `GET /clients/:id`.
- **End-users** (tenant secret): `POST /clients/:tenant/users`, `GET /clients/:tenant/users`.
- **Token mint** (tenant secret): `POST /tokens` `{endUserId, scope}` → short-lived opaque
  token. The heart of the spine.
- **Gated data** (end-user token): `GET /data/:tenant/...` — authorized by token claims;
  cross-tenant access blocked.
- **Stripe** (tenant secret / token as appropriate): `PUT /clients/:tenant/stripe` (set
  config), `POST /checkout/:tenant` `{priceId, successPath, cancelPath}` → session URL,
  `POST /webhooks/stripe` (signature-verified, reconciles `payments`).
- `GET /healthz`.

## Worker ↔ core contract

- Worker calls the core over HTTPS with a **signed service token** (shared secret or mTLS)
  proving "this is our edge," but the core **re-authorizes** every request by the end-user
  token — the service token is transport trust, not authorization.
- Worker responsibilities: routing, rate limiting, CORS for foreign-origin embeds, static
  assets, forwarding the bearer token. Core responsibilities: mint, verify, authorize, all
  data and money logic.
- Keep the core behind a clean HTTP contract so it stays portable (the lock-in hedge).

## Project structure

```
core/
  cmd/server/main.go          — wiring, config, server start
  internal/
    config/                   — typed env config
    http/                     — chi router, middleware (auth, rate, requestID), handlers
    tenants/                  — client onboarding + API keys
    users/                    — end-user registration
    tokens/                   — mint + verify (the AuthorizationServer)
    stripe/                   — config, checkout, webhooks (stripe-go)
    audit/                    — append-only audit log
    store/                    — pgx + sqlc-generated queries, migrations
  migrations/                 — golang-migrate SQL
  Dockerfile
```

The `tokens` package is the `AuthorizationServer` interface from `AUTH_ARCHITECTURE.md`,
now concrete in Go.

## Security checklist

- Secret keys and tokens stored hashed; Stripe keys encrypted at rest; never logged.
- Tokens short-lived + revocable; every data query scoped by tenant (+ RLS hardening).
- Stripe webhooks signature-verified; payments reconciled from webhooks, not client redirects.
- Card data never touches the core (Stripe-hosted Checkout → PCI SAQ A).
- Audit-log every access to regulated data (thin now, load-bearing when credit arrives).
- Platform-admin endpoints behind a separate admin credential, not a tenant key.

## Build order (sprint milestones)

- **M0 — Scaffold. [DONE — code in `core/`]** `chi` server, typed config, pgx pool +
  embedded transactional migrations, `/healthz` (liveness) + `/readyz` (DB readiness),
  graceful shutdown, Dockerfile, `fly.toml`. Verified locally end-to-end: builds, unit
  tests pass, boots with and without a DB, migrations apply idempotently (tenants +
  tenant_api_keys). *Remaining for prod:* `fly deploy` + Neon (needs your accounts).
- **M1 — Client onboarding.** `POST /clients` (admin), API-key issuance (publishable +
  hashed secret). *Verify:* create a client, get keys once; secret never re-returned.
- **M2 — End-users.** Register/list under a tenant, authed by tenant secret. *Verify:*
  tenant-scoped; wrong secret 401.
- **M3 — Token mint + verify.** `POST /tokens` + the verify middleware + one gated resource.
  *Verify:* valid token → data; cross-tenant / wrong-scope / expired → rejected.
- **M4 — Stripe.** Per-tenant config (encrypted), `POST /checkout` (test mode), webhook
  reconciliation. *Verify:* configure → checkout → test card `4242…` completes → `payments`
  row recorded via webhook.
- **M5 — Wire the edge + component.** Worker routes to the core (signed service token, CORS);
  the customizable Stripe component (traits: priceId, label, success/cancel) uses a minted
  token; mock-in-editor, live-on-page. *Verify:* end-to-end from the editor through a
  published/embedded page to a completed test checkout.

## Deferred (attaches to this without reshaping it)

Double-entry ledger + balances, the credit/FCRA data plane (consent + provider integration),
platform-hosted end-user auth, JWT/Redis for stateless scale, KYB/KYC, multi-region.
