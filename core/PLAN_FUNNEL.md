# Core Plan — Funnel Accounts (email-link identity for the deploy funnel)

Self-contained work order for the Go core (`core/`). Implements the core side of
`docs/FUNNEL.md` phases 1–3 plus dashboard v0 — the two locally
testable flows: register-first (button → email link → dashboard) and build-first
(publish → email capture → confirm → deploy-on-visit). A parallel plan covers the
editor/Worker side (`docs/PLAN_FUNNEL.md`). **This document's
"Shared contract" section is canonical** — the editor plan links here.

## Scope guardrails

- **In:** accounts, email confirmations (magic links), sessions, site ownership,
  a dev mailbox for local testing.
- **Out (explicitly):** payment/subscription gates and universal expiry
  (FUNNEL.md phases 4–5), real email delivery (Resend/Postmark — later), any
  linkage to tenants/`pk_`/`sk_` (accounts own *sites*; the tenant model is
  untouched), custom domains.
- Division of truth: **core owns who the account is and which subdomains it
  owns.** The Worker owns the serving state machine (drafted/armed/published in
  R2 meta) and all content. Core never stores content; the Worker never stores
  identity. All arrows stay browser → Worker → core (service-authed); core
  never calls the Worker.

## What already exists (do not rebuild)

- Edge auth middleware, per-tenant/IP rate limiting, audit log, embedded
  migrations (latest: `0005_namespace_binding`), OpenAPI + route-drift test,
  `archauth` token generate/hash helpers, dev/prod env split (`ARCHURA_ENV`).
- Token conventions: `pk_`/`sk_`/`ct_`/`ses_` exist. This plan adds `cfm_`
  (confirmation) and `sess_` (account session) — distinct from `ses_`
  (component-session id) to avoid ambiguity.

## Shared contract (canonical — editor plan links here)

All endpoints in the `/v1` group (edge auth + trusted-IP middleware apply).
Errors use the existing envelope. TTLs: confirmation 1h, session 7d.

**1. Create a confirmation (Worker calls this on deploy or register):**

```
POST /v1/confirmations
{ "email": "a@b.com", "subdomain": "mikes-bakery" }   // subdomain optional
→ 201 { "id": "...", "expires_at": "...",
        "confirm_url": "..." }                        // confirm_url in dev ONLY
```

- Generates a `cfm_` token; **Postgres stores only its hash** with email +
  optional subdomain; single-use; 1h TTL.
- `confirm_url` = `CONFIRM_URL_BASE` config + `?token=cfm_...` — returned only
  when `ARCHURA_ENV=dev` (local testing). In prod the token would go out via a
  transactional email provider (out of scope; leave a seam — a delivery
  interface with the dev outbox below as its only implementation).
- **Dev delivery outbox (in-memory, dev only):** the plaintext `confirm_url`
  lives only in a process-memory outbox that feeds the 201 response and the
  dev mailbox (§5). Plaintext never enters Postgres; a core restart clears
  pending links (acceptable locally — re-request the confirmation).
- Rate limit — **prod only**: per email and per trusted client IP, 5/hour each
  (requires the limiter's configurable window, work item 3). The limit exists
  to protect production email sending (spam-from-our-domain, sender
  reputation, cost) and subdomain squatting; **in `ARCHURA_ENV=dev` skip
  confirmation rate limiting entirely** — there is no provider, no cost, and
  no reputation locally, and any dev limit starves the verify loop and manual
  testing (observed in practice). The 429 path stays covered by unit tests.
- Email validation: syntactic only; lowercase + trim before storing.

**2. Verify a confirmation (Worker calls this when the link is clicked):**

```
POST /v1/confirmations/verify
{ "token": "cfm_..." }
→ 200 { "account": { "id": "...", "email": "a@b.com" },
        "subdomain": "mikes-bakery" | null,
        "session": { "token": "sess_...", "expires_at": "..." } }
```

- Valid + unexpired + unused token: mark used, **create the account if the
  email is new** (else attach), bind `subdomain` ownership when present, mint a
  `sess_` session (hash stored, 7d TTL), return it once. All of this is one
  transaction.
- Invalid/expired/used → 401 `invalid_token`.
- **Ownership conflict:** if the confirmation names a subdomain already owned
  by a *different* account → 409 `site_owned`, the entire transaction rolled
  back, and the confirmation left **unused** (no account, no session, no
  partial state). The Worker renders this as "that name was taken in the
  meantime."
- Audit every outcome, including a defined event for rejected verification
  (`confirmation.verify_rejected`) and for the 409 path
  (`site_ownership.rejected`).

**3. Session introspection (Worker gates the dashboard with this):**

```
GET /v1/sessions/me
Authorization: Bearer sess_...
→ 200 { "account": { "id": "...", "email": "..." },
        "sites": ["mikes-bakery", "second-site"] }
```

- Expired/revoked/unknown → 401. The Worker may cache a positive result
  briefly (≤60s) — design the endpoint to be cheap regardless.

**4. Bind a site to the session's account (register-first claim path):**

```
POST /v1/site-ownership
Authorization: Bearer sess_...
{ "subdomain": "mikes-bakery" }
→ 201 { "subdomain": "...", "account_id": "..." }
```

- Session-authed (not service-trust): the account can only bind sites to
  itself. Conflict (subdomain already owned by another account) → 409
  `site_owned`. Idempotent for the same account.
- ~~**One site per account (prototype rule)**~~ — **RESCINDED 2026-07-19**:
  site and organization counts are unrestricted
  (`core/PLAN_EMBED_IDENTITY.md` target model). Remove the
  `account_has_site` 409 from all three bind points as part of the embed-
  identity plan; `site_owned` (cross-account conflict) remains. The
  `verify-funnel.mjs` duplicate-deploy check flips to expect success when
  enforcement is removed.

**5. Logout (session revocation):**

```
POST /v1/sessions/logout
Authorization: Bearer sess_...
→ 204
```

- Sets `revoked_at` on the session; idempotent (revoking a revoked/unknown
  session is still 204 — logout must never fail). The Worker clears the
  cookie regardless and treats this call as best-effort, so shipping it later
  degrades gracefully — but without it a leaked cookie value stays valid
  until the 7d expiry, so it belongs in the same milestone.

**6. Dev mailbox (local testing only):**

```
GET /v1/dev/confirmations          (404 unless ARCHURA_ENV=dev)
→ 200 { "confirmations": [ { "email": "...", "subdomain": "...",
         "confirm_url": "...", "created_at": "...", "used": false } ] }
```

- Most recent first, cap ~50. This is how a human or verify script finds the
  magic link locally without an email provider. Never available in prod.
- **Entries persist after use** — the mailbox is the local stand-in for a real
  inbox, and a real inbox keeps its mail. Mark used entries `"used": true`
  (and expired-unused ones `"expired": true`) instead of dropping them; the
  dev-mail page renders them accordingly. Entries drop only when the cap
  evicts them or the core restarts.
- Served from the **in-memory dev outbox** (§1), not from Postgres — the
  database has only hashes.

## Work items (in order)

### 1. Migration `0006_accounts`

Tables: `accounts` (id, email UNIQUE, created_at), `email_confirmations`
(id, token_hash UNIQUE, email, subdomain NULL, expires_at, used_at NULL,
created_at), `account_sessions` (id, token_hash UNIQUE, account_id FK,
expires_at, revoked_at NULL, created_at), `account_sites` (subdomain PRIMARY
KEY, account_id FK, created_at). Down migration included.

**Audit schema extension (same migration):** the `0003` audit constraints only
permit tenant-shaped actor types/actions/resource types and successful
outcomes. Extend the CHECKs to cover: actor type `account` (and the anonymous
pre-account verify path), actions `confirmation.created`,
`confirmation.verified`, `confirmation.verify_rejected`, `account.created`,
`session.created`, `site_ownership.bound`, `site_ownership.rejected`, resource
types `confirmation`/`account`/`session`/`site`, and non-success outcomes for
the rejected events.

*Verify:* applies idempotently from a database at `0005`; a
`confirmation.verify_rejected` audit row inserts successfully.

### 2. Store layer + token kinds

`CreateConfirmation`, `ConfirmationByTokenHash` + `MarkConfirmationUsed` (in one
transaction with account upsert + ownership bind + session insert — the verify
step must be atomic; the ownership-conflict 409 rolls the whole transaction
back with the confirmation left unused), `AccountByEmail`/upsert,
`SessionByTokenHash`, `SitesForAccount`, `BindSiteOwnership` (with
cross-account conflict detection).

Add `cfm` and `sess` to the `archauth` token helper's recognized kinds
(generate + `HasKindForEnv`).

*Verify:* store tests — confirmation single-use under concurrent verify;
ownership conflict rolls back and leaves the token unused; session expiry
respected; token helper round-trips both new kinds.

### 3. Rate limiter: configurable windows

The current limiter is fixed to one-minute windows; the 5/hour email limits
need a window parameter. Extend the limiter (store + config) to take a window
duration per operation, defaulting existing operations to their current
one-minute behavior — no change to existing limits.

*Verify:* limiter tests — hour-window limit trips on the 6th call and resets
after the window; existing minute-window operations unchanged.

### 4. Handlers per the contract

Follow the existing handler idioms (rate limits, audit events —
`confirmation.created`, `account.created`, `session.created`,
`site_ownership.bound` — request-id logging, `Cache-Control: no-store` on
anything carrying a token). `CONFIRM_URL_BASE` joins the config struct
(required in dev when confirmations are used; e.g.
`http://localhost:8787/confirm`).

*Verify:* handler tests — full happy path (create → verify → me → bind);
expired/used/invalid token 401; second verify of same token 401; dev mailbox
404 in prod env; `confirm_url` absent from the 201 in prod env; rate limits.

### 5. Maintenance cleanup

Extend the existing maintenance job (`cmd/maintenance`) to purge expired/used
`email_confirmations` and expired/revoked `account_sessions`, alongside its
current duties.

*Verify:* maintenance run removes an expired confirmation and session; live
ones survive.

### 6. Contract surface

OpenAPI additions for all five operations (route-drift test must pass);
`core/README.md` endpoint list update.

*Verify:* `go test ./...` green.

## Done means

From a clean local core: `POST /v1/confirmations` (dev) returns a
`confirm_url`; verifying it creates the account, binds the site, returns a
working session; `GET /v1/sessions/me` lists the site; a second verify of the
same token fails; the dev mailbox lists pending confirmations and is absent in
prod config; `go test ./...` green.
