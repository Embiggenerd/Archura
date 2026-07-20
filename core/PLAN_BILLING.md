# Organization Billing — Implemented Contract

## Product boundary

- Accounts are people. Organizations are businesses and billing boundaries.
- One account may belong to many organizations; only organization owners manage billing.
- One $5/month subscription covers every site and embedded component owned by the
  organization. Site and member counts remain unrestricted.
- This plan charges for Archura hosting/editing only. Stripe Connect onboarding,
  merchant payment components, transaction fees, and live-money movement are out of scope.

## Lifecycle

| State | Edit/publish | Serve pages/embeds | Billing action |
|---|---:|---:|---|
| Trial not started | Yes | No published content yet | Trial starts at first publish |
| 30-day trial | Yes | Yes | Owner may subscribe early |
| Active subscription | Yes | Yes | Owner uses Stripe portal |
| 7-day grace | No | Yes | Owner restores the subscription |
| Expired | No; editor is read-only | No | Owner subscribes/restores |
| 60-day recovery elapsed | No | No; artifacts deleted | Site name is released |

Trial creation is idempotent. A canceled paid subscription remains fully active through
its paid period, then receives the same seven-day serving grace. A payment failure blocks
editing immediately and starts seven days of serving grace from the Stripe status event.

## Ownership of responsibilities

### Go Core

- Stores `organization_billing`, Stripe identifiers/status, deadlines, and the durable
  webhook event ledger in Postgres.
- Creates Stripe Customers, hosted subscription Checkout sessions, and customer portal
  sessions with Stripe's official Go SDK.
- Verifies webhook signatures and test/live mode, then retrieves current subscription
  state from Stripe before committing it.
- Exposes one normalized entitlement response so the Worker and UI do not interpret raw
  Stripe statuses independently.
- Records allowlisted billing audit events without logging secrets, payment details, or
  full webhook bodies.

### Cloudflare Worker

- Starts the organization trial immediately before first publication.
- Enforces `can_edit` on artifact, embed, and asset writes; failures are closed when Core
  cannot be reached.
- Enforces `can_serve` on hosted pages, raw artifacts/assets, and every embed URL. Existing
  content fails open during a temporary Core outage and entitlement responses are cached
  for at most 60 seconds.
- Marks expired sites for a 60-day recovery window. A daily scheduled cleanup removes the
  site's R2 namespace, stable embed projection, and moderation index after that window.
- Bounds anonymous JSON, artifact, embed, and image uploads and applies the existing edge
  rate limiter by operation and client IP. Production site claims require an account
  session; the old fixed IP allowlist is removed.
- Runs structural content checks on publication. Flags require manual review: the scanner
  never auto-suspends. `MODERATION_ADMIN_KEY` protects list, suspend, and restore routes.

### Frontend

- The account page lists every organization with role, sites, component count, and plan
  state.
- Each organization dashboard explains the exact lifecycle state and gives owners a
  Checkout or portal action. Members are told to contact an owner.
- Expired organizations may load their artifacts in a visibly read-only editor so an owner
  can inspect the recoverable work before subscribing.

## Configuration

Core enables billing only when all four values are present:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_BASIC_PRICE_ID`
- `BILLING_PUBLIC_ORIGIN`

The Worker keeps `CORE_SERVICE_KEY` and `MODERATION_ADMIN_KEY` as secrets. Stripe secrets
never enter Worker variables, browser bundles, fixtures, or committed environment files.

## Verification gates

- `go test ./...` covers trial, active, grace, expired, canceled, payment-failure,
  owner/member, Checkout, portal, webhook ordering, and duplicate delivery behavior.
- `scripts/verify-worker-billing.mjs` covers Worker write/serve enforcement, body limits,
  manual moderation, Core-outage serving, and scheduled recovery deletion.
- The normal production build and existing account/funnel suites must remain green before
  deployment. Deployment and creation of real Stripe resources require separate operator
  authorization.
