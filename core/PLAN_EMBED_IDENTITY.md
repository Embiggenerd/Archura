# Core Plan — Organizations + Publishable Keys for Funnel Clients

> **Status: ACTIVE.** Decided 2026-07-19: `pk_` is identity and identity is
> core-owned — no edge-minted placeholder keys, ever. The edge only *stores
> and resolves* what the core mints. Also decided the same day: **"tenant" is
> renamed "organization"**, and ownership is restructured to the durable
> shape: account ↔ organization via memberships (many-to-many, role-carrying);
> the organization owns the site. See `docs/AUTH_ARCHITECTURE.md` (vocabulary
> note at the top).

Work order for the Go core. Companion to `docs/PLAN_EMBEDS.md` (editor/
Worker side). **This document's "Shared contract" section is canonical.**

## Why

Embedded components must identify their client by the durable public
identifier — the publishable key — not by the site slug (renamable,
releasable; `docs/AUTH_ARCHITECTURE.md` § identity vs. address). The embed URL
becomes `https://embed.archura.ai/<pk_>/<Component>.js`. Funnel accounts have
no `pk_` because accounts and tenants(organizations) are still separate
identity systems. This plan merges them at the one point they meet — email
confirmation — and does the rename while the tables are open.

## Target model

```
accounts ←— memberships (account_id, organization_id, role) —→ organizations
                                                                    │ owns
                                                                    ▼
                                              sites, keys, payment components,
                                              component sessions, audit,
                                              end-users (later)
```

- **Organization = the isolation boundary** (formerly tenant): keys, payment
  config, audit, end-users, and — after this plan — site ownership all hang
  off it, never off a person.
- **Default organization (decided 2026-07-19):** creating an account creates
  its default organization in the same transaction (name derived from the
  email local part or the first site; renamable later). Sites created through
  the funnel bind to the account's default organization until an org selector
  exists. Accounts can create further organizations
  (session-authed `POST /v1/organizations`), and other accounts can be
  members of them (invitation APIs remain out of scope; the schema is ready).
- **No count restrictions** — sites per organization and organizations per
  account are both unlimited. The earlier "one deploy per email" /
  `account_has_site` rule is **rescinded** (see the note in
  `core/PLAN_FUNNEL.md`); remove its enforcement as part of this plan.
  `organization_sites` therefore has NO unique constraint on
  `organization_id` — subdomain stays the primary key.
- **Membership** carries the role; account creation writes the `owner` row
  for the default org.
- There is no "workspace" concept — the dashboard is the organization-scoped
  experience. An agency = one account with memberships in many organizations —
  never one org containing many businesses, because keys/Connect/liability
  are per-business.

## Shared contract (canonical)

**1. Confirmation verify mints the client identity.**

`POST /v1/confirmations/verify` (existing) additionally, in the same
transaction, when the confirmation carries a `subdomain`:

- Ensure an **organization** for the site: create one (name + slug = the
  subdomain, allowed origins = the site's origins) with the usual
  publishable + secret key pair; the site becomes organization-owned; the
  account gets an `owner` membership. Idempotent — re-verify scenarios must
  not duplicate organizations or memberships.
- The secret key is **not returned** in this flow (rotatable later via the
  dashboard per `DASHBOARD.md`).

Response gains the key:

```json
{ "account": { "id": "…", "email": "…" },
  "subdomain": "mikes-bakery",
  "organization_id": "…",
  "publishable_key": "pk_test_…",
  "session": { "token": "sess_…", "expires_at": "…" } }
```

**2. Session introspection becomes organization-oriented.**

`GET /v1/sessions/me` — the canonical shape lists memberships:

```json
{ "account": { "id": "…", "email": "…" },
  "organizations": [
    { "id": "…", "name": "Mike's Bakery", "role": "owner",
      "publishable_key": "pk_test_…",
      "sites": [ { "subdomain": "mikes-bakery" } ] }
  ],
  "sites": ["mikes-bakery"],
  "publishable_keys": { "mikes-bakery": "pk_test_…" } }
```

(`sites` is an array per organization — counts are unrestricted.)

`organizations` is canonical. `sites`/`publishable_keys` are **compatibility
fields only** (the Worker consumes them today); they are not canonical and
drop once the Worker migrates. No `subscription` field — billing doesn't
exist yet and the contract must not invent fields for unbuilt features
(billing attaches to the organization when FUNNEL phase 4 ships).

**3. Register-first claims get the same treatment.** `POST /v1/site-ownership`
(session-authed, existing) performs the same ensure-organization + owner-
membership step and returns `organization_id` + `publishable_key`.

## Work items

### 1. Rename tenant → organization

Mechanical but wide; do it first, alone, in one migration + one code sweep so
review is trivial: `tenants` → `organizations`, `tenant_api_keys` →
`organization_api_keys`, `tenant_id` columns/FKs, `store.Tenant` →
`store.Organization`, `authenticateTenant` → `authenticateOrganization`,
`TenantByPublishableKey` → `OrganizationByPublishableKey`, audit
`actor_type`/metadata values, log fields, OpenAPI wording. **The external API
renames too**: `POST /v1/clients` → `POST /v1/organizations` (same handler),
with `/v1/clients` kept briefly as a compatibility alias for the existing
scripts (`register-test-client.mjs`, `verify-core-identity.mjs`) until they
are updated — early is the cheapest time to unify vocabulary.

*Verify:* `go test ./...` green with zero behavior change; both routes serve
identically during the alias window; grep finds no live `tenant` outside
migrations history.

### 2. Memberships + organization-owned sites

Migration (next free number): `memberships` (account_id FK, organization_id
FK, role, created_at; PK account+org). `account_sites` →
`organization_sites` (subdomain PK, organization_id FK); backfill existing
rows by creating an organization per bound account-site with an owner
membership (small local/test data — a best-effort backfill is fine, keyless
legacy rows may instead be dropped).

*Verify:* migration applies from the current head; a confirmed site resolves
account → membership → organization → site.

### 3. Contract endpoints (per the canonical contract above)

Ensure-organization in confirmation verify + site-ownership; `sessions/me`
via memberships; `organization_id` + `publishable_key` in responses. Audit:
`organization.created`, `membership.created` (extend the audit CHECKs as in
the 0006 pattern).

*Verify:* confirm-with-subdomain creates exactly one organization + owner
membership and returns pk; re-runs don't duplicate; `sessions/me` maps sites
to pks; register-first claim path equivalent; one-site rule now enforced
per-organization; existing component-session tests unaffected;
`go test ./...` green.

## Out of scope

- Invites / additional members / roles beyond `owner` (the table is ready;
  the features wait for a second human).
- Checkout endpoints, secret-key exposure, Connect (later milestones).
- Any styling/config serving by pk — the edge serves baked modules; core
  only mints identity (edge-first doctrine).
