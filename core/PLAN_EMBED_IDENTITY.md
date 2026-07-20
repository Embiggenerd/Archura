# Core Identity Contract — Accounts, Organizations, and Funnel Sites

> **Status: IMPLEMENTED.** Decided 2026-07-19: `pk_` is identity and identity is
> core-owned — no edge-minted placeholder keys, ever. The edge only *stores
> and resolves* what the core mints. Also decided the same day: **"tenant" is
> renamed "organization"**, and ownership is restructured to the durable
> shape: account ↔ organization via memberships (many-to-many, role-carrying);
> the organization owns the site. See `docs/AUTH_ARCHITECTURE.md` (vocabulary
> note at the top).

Companion to `docs/PLAN_EMBEDS.md` (editor/Worker side). **This document's
"Shared contract" section describes the implemented core behavior.**

## Why

Embedded components must identify their client by the durable public
identifier — the publishable key — not by the site slug (renamable,
releasable; `docs/AUTH_ARCHITECTURE.md` § identity vs. address). The embed URL
is `https://embed.archura.ai/<pk_>/<site_id>/<Component>.js`: the organization
key establishes the business identity and the permanent site ID selects its
artifact namespace. Email confirmation creates or reuses the account's
default organization and therefore its `pk_`; the site slug is only an address.

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
  config, audit, end-users, and site ownership all hang
  off it, never off a person.
- **Default organization (decided 2026-07-19):** creating an account creates
  its default organization in the same transaction (name derived from the
  email local part; renamable later). Build-first funnel deploys bind to the
  account's default organization; organization-scoped dashboard claims bind to
  the selected organization. Accounts can create further organizations
  (session-authed `POST /v1/organizations`), and other accounts become members
  through email-addressed, owner-created invitations.
- **No count restrictions** — sites per organization and organizations per
  account are both unlimited. The earlier "one deploy per email" /
  `account_has_site` rule is **rescinded** (see the note in
  `core/PLAN_FUNNEL.md`) and is not enforced.
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
transaction:

- Create or verify the global account and ensure exactly one **default
  organization** with its publishable + secret key pair and an `owner`
  membership. Existing accounts reuse their default organization.
- When the confirmation carries a `subdomain`, bind that site to the default
  organization. Confirming additional sites must not create more organizations
  or memberships. The operation is idempotent with respect to account and
  organization identity.
- The secret key is **not returned** in this flow (rotatable later via the
  dashboard per `DASHBOARD.md`).

Response:

```json
{ "account": { "id": "…", "email": "…", "email_verified_at": "…" },
  "organization": {
    "id": "…", "name": "Mike's organization", "role": "owner",
    "is_default": true, "publishable_key": "pk_test_…", "sites": []
  },
  "subdomain": "mikes-bakery",
  "session": { "token": "sess_…", "expires_at": "…" } }
```

**2. Session introspection becomes organization-oriented.**

`GET /v1/sessions/me` — the canonical shape lists memberships, verified email,
and pending invitations:

```json
{ "account": { "id": "…", "email": "…", "email_verified_at": "…" },
  "organizations": [
    { "id": "…", "name": "Mike's Bakery", "role": "owner",
      "is_default": true,
      "publishable_key": "pk_test_…",
      "sites": ["mikes-bakery"] }
  ],
  "invitations": [
    { "id": "…", "organization": { "id": "…", "name": "Other Bakery" },
      "email": "mike@example.com", "role": "member", "status": "pending",
      "expires_at": "…" }
  ] }
```

(`sites` is an array per organization — counts are unrestricted.)

`organizations` is canonical, and each organization contains its own site
list and publishable key. No `subscription` field — billing doesn't exist yet
and the contract must not invent fields for unbuilt features
(billing attaches to the organization when FUNNEL phase 4 ships).

**3. Register-first claims get the same treatment.** `POST /v1/site-ownership`
(session-authed, existing) binds a site to the requested organization when the
account is a member, or to the default organization when no organization is
specified. Site counts are unrestricted.

**4. Invitations add memberships, not identity.** An owner invites a normalized
email address as a `member`. Repeating the request refreshes and reuses the one
pending invitation, including after a notification delivery failure. A failed
email returns `502 email_delivery_failed`; retrying the same request sends the
same invitation again. Acceptance requires an authenticated account with that
exact verified email and atomically creates its membership.

## Implemented work

### 1. Rename tenant → organization

The live schema, Go types, handlers, logs, and OpenAPI contract use
`organization`; historical migrations retain old vocabulary where rewriting
history would be unsafe. `POST /v1/clients` remains a platform-admin
compatibility endpoint, while account-authenticated organization creation is
`POST /v1/organizations`.

*Verify:* `go test ./...` is green; live vocabulary uses organization outside
migration history and explicit compatibility surfaces.

### 2. Memberships + organization-owned sites

`organization_memberships` provides the many-to-many account/organization
relationship and carries `owner` or `member` plus the per-account default flag.
`organization_sites` binds unrestricted site addresses to organizations.

*Verify:* migrations apply from the current head; a confirmed site resolves
account → membership → default organization → site.

### 3. Contract endpoints (per the canonical contract above)

Confirmation verification and site ownership resolve through memberships;
`sessions/me` returns organizations, per-organization sites and keys, verified
email, and pending invitations. Owners can invite an email as a member;
acceptance requires a session for that exact verified email.

*Verify:* confirmation creates or reuses exactly one default organization and
owner membership; additional sites bind to it without count restrictions;
invitations create member memberships; existing component-session tests remain
unaffected; `go test ./...` is green.

## Out of scope

- Roles and permission levels beyond `owner` and `member`.
- Checkout endpoints, secret-key exposure, Connect (later milestones).
- Any styling/config serving by pk — the edge serves baked modules; core
  only mints identity (edge-first doctrine).
