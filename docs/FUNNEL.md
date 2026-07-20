# Deploy Funnel — Anonymous → Confirmed → Trial → Paid

This is the current product funnel for every Archura artifact. Pages and smaller
components use the same publication, embed, identity, billing, and recovery rules.

## Principles

- **Value before signup.** A visitor can edit an in-browser draft before entering an
  email address.
- **Email before publication.** Deploy reserves a subdomain and stores an R2 draft, but
  the content does not go live until its email confirmation succeeds.
- **Organizations pay.** Accounts are people; organizations are businesses and billing
  boundaries. One organization plan covers all of its unrestricted sites and components.
- **A useful free trial.** The 30-day trial includes editing, publishing, hosted pages,
  and embeds. No card is required.
- **Recovery before deletion.** Publishing stops first, serving stops seven days later,
  and artifacts remain recoverable for another 60 days.
- **Hosting billing is separate from merchant payments.** The $5 Archura subscription
  does not onboard a merchant to Stripe Connect or change payment-component behavior.

## State sequence

```text
Anonymous browser draft
        │ Deploy: subdomain + email
        ▼
DRAFTED IN R2
        │ email confirmation creates/reuses the account and default organization
        │ binds the site, starts the organization trial, and publishes immediately
        ▼
30-DAY ORGANIZATION TRIAL
        │ all organization members may edit/publish; pages and embeds serve
        │ owner may subscribe for $5/month at any point
        ├──────────────────────────────▶ ACTIVE SUBSCRIPTION
        │                                  │ cancel: active through paid period
        │ trial or paid entitlement ends   │ payment/period ends
        ▼                                  ▼
7-DAY SERVING GRACE (editing and publishing blocked)
        │ owner restores billing → ACTIVE SUBSCRIPTION
        │ grace ends
        ▼
EXPIRED (editor read-only; pages and embeds unavailable)
        │ owner restores within 60 days → ACTIVE SUBSCRIPTION
        │ recovery window ends
        ▼
R2 ARTIFACTS DELETED; SUBDOMAIN RELEASED
```

The 30-day clock starts once per organization at its first publication, not at account
registration, organization creation, site claim, or anonymous editing. Creating more sites
never restarts or extends the trial.

## Where state lives

- **Go Core:** accounts, organizations, memberships, organization-owned site bindings,
  trial/subscription state, Stripe customer and subscription identifiers, webhook ledger,
  billing audit events, and the normalized edit/serve entitlement.
- **Cloudflare Worker:** R2 drafts and published artifacts, stable embed projections,
  trial-start orchestration at publish time, entitlement enforcement, recovery metadata,
  scheduled artifact deletion, rate limiting, bounded request bodies, and moderation.
- **Frontend:** anonymous draft UX, confirmation messaging, organization plan status,
  owner Checkout/portal actions, and the expired read-only editor.
- **Stripe:** test-mode Customer, recurring $5 Price, subscription Checkout, customer
  portal, and signed billing events. Stripe is not an identity or content store.

Core never stores component artifacts. The Worker never stores Stripe secrets or decides
billing rules from raw Stripe statuses.

## Identity and ownership

- Confirmation creates or reuses the account and its default organization, then binds the
  deployed site to that organization.
- Accounts reach a site only through organization membership. Owners manage billing and
  invitations; members can edit and publish while the organization is entitled.
- Every site carries a permanent `site_…` ID. The current subdomain is an address, not the
  durable identity.
- Stable embed URLs use `/<publishable_key>/<site_id>/<component>.js`; resolution verifies
  that the organization key, permanent site ID, and current site metadata still agree.
- A released subdomain cannot take over an earlier owner's embed URL.

## Billing behavior

The Core entitlement is the only contract consumers use:

- `unstarted`: editing is allowed; serving is false because nothing has published.
- `trialing`: editing and serving are allowed until `trial_ends_at`.
- `active`: editing and serving are allowed. Cancellation at period end does not remove
  access early.
- `grace`: editing/publishing is blocked; existing pages and embeds serve until
  `serve_grace_ends_at`.
- `expired`: editing/publishing and public serving are blocked. Artifacts remain in R2 until
  the 60-day recovery deadline.

Entitlement reads used for public serving may be cached for 60 seconds. Writes always ask
Core for fresh state and fail closed if it is unavailable. Already-published public content
fails open during a temporary Core outage so an internal outage does not take customer
sites down.

## Abuse and content operations

- Anonymous register/deploy, site claims, artifact publication, embed publication, and
  asset uploads use operation/IP edge rate-limit keys. Core retains its authoritative
  confirmation and organization limits.
- Request bodies are bounded before parsing or R2 storage.
- Production site claims require an authenticated account and selected organization. The
  old operator-IP allowlist is gone. Local claim-token compatibility is enabled only by
  the explicit `ALLOW_ANONYMOUS_SITE_CLAIMS=true` Worker variable; `PUBLIC_ORIGIN` only
  controls generated URLs.
- Publication checks structural risk signals such as password collection, external form
  actions, active embedded content, inline handlers, JavaScript URLs, meta refresh, and
  excessive external links.
- A signal creates a minimal moderation record and structured log; it never auto-bans.
  Staff review with a secret-protected endpoint and may suspend or restore the site.
- Logs and moderation records contain site/organization IDs and reason codes, not artifact
  bodies, tokens, customer email addresses, or payment details.

## Verification

- A drafted deployment serves only the loader.
- Confirmation binds the organization, starts the trial once, publishes the artifact, and
  returns both preview and copy/paste embed information.
- All sites in one organization share the same deadline and subscription.
- At trial end, writes return the billing-required response while public content still
  serves for seven days.
- At grace end, hosted pages and every embed route stop serving.
- Payment restoration re-enables all organization sites without changing embed URLs.
- Scheduled cleanup deletes content only after the 60-day recovery window.
- Flagging alone keeps a site live; manual suspension blocks it and restoration reverses it.

Implementation details and environment variables are recorded in
`core/PLAN_BILLING.md`; identity doctrine remains in `AUTH_ARCHITECTURE.md`.

## Deferred

- Stripe Connect merchant onboarding and transaction-fee economics.
- Custom domains and custom-hostname TLS.
- A staff moderation GUI; the initial operator surface is an authenticated API.
- Automated reputation scoring or automatic suspension.
