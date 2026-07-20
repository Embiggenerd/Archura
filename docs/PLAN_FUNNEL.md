# Editor Plan — Deploy Funnel + Dashboard v0 (locally testable)

Work order for `archura-editor` (editor package + `workers/site-worker.js` +
dashboard page). Implements `FUNNEL.md` phases 1–3 plus a first dashboard, so
both registration flows are testable locally:

- **Flow 1 (register-first):** Register button → email link → dashboard →
  create a page / customize the Stripe component → publish → embeddable
  snippet, or subdomain link.
- **Flow 2 (build-first):** edit anonymously → pick subdomain + publish →
  email capture + loader → confirm via link → visiting the subdomain triggers
  the deploy → loader until served. Dashboard access afterward.

The core side (accounts, confirmations, sessions, ownership) is specified in
`core/PLAN_FUNNEL.md` — **its "Shared contract" section is canonical**; this
plan links to it. Read it before items 2–6. Core is built by a different model;
do not edit `core/`.

## Scope guardrails

- **Out:** payment/subscription gates, universal expiry (FUNNEL.md phases 4–5),
  real email delivery (dev mailbox only), custom domains, tenants/`pk_` work.
- **Division of truth:** the Worker owns the serving state machine and content;
  core owns identity and ownership. Session tokens live in an **HttpOnly
  cookie** set by the Worker (`Secure` in prod, `SameSite=Lax`) — never exposed
  to page JS, never in localStorage.
- **Back-compat invariant:** existing sites have no `status` in their
  `meta.json`. Missing status ⇒ `published`. Nothing about today's claim-token
  flow breaks; session auth is additive.

## State machine (Worker-owned, in `sites/<site>/meta.json`)

> As built, meta also stamps a permanent `siteId` (`site_…`) at claim/deploy — the
> durable identity ahead of custom domains and subdomain release; see `FUNNEL.md`
> § "Identity vs. address" and `AUTH_ARCHITECTURE.md` § Namespaces.

```
status: absent → published (legacy)     draft content: sites/<site>/draft/…
POST /api/deploys  → drafted            live content:  sites/<site>/…  (as today)
confirm link       → armed  (+ ownerAccountId)
first visit while armed → promote (copy draft/ → live, delete draft/) → published
```

`drafted` and `armed` subdomains serve the **loader page** — which is nearly
free: the existing site shell already polls `artifact.json` every 3s and
re-renders in place, so the placeholder page *is* a live-updating loader. Style
it as one (spinner + "deploying…" copy) and the post-promote appearance needs
no reload.

## Work items (in order)

### 1. Worker state machine + promote-on-visit

- `POST /api/deploys` — body `{ site, email, artifact, embeds }`. Gated by the
  existing `claimAllowed()` IP allowlist (the funnel is the eventual
  replacement for IP gating, but keep it during local testing; loopback is
  exempt). Checks availability (`meta.json` absent), writes
  `sites/<site>/draft/pages/….json` + `draft/embed/….js`, writes meta
  `{ site, status: 'drafted', createdAt }` (no claim token — post-confirm
  edits authenticate by session), then calls core
  `POST /v1/confirmations { email, subdomain }` (service header, reusing
  `proxyCore`'s wiring). Respond `201 { site }`.
- `GET /confirm?token=cfm_…` — calls core `POST /v1/confirmations/verify`.
  On success: meta → `{ status: 'armed', ownerAccountId }`, set the session
  cookie from the returned `sess_` token, redirect to a small "confirmed"
  page linking the subdomain and `/dashboard/`. On 401 → friendly error page.
  On **409 `site_owned`** (the name was claimed by another account between
  deploy and confirm) → "that name was taken in the meantime" page with a
  link back to the editor; no cookie is set (core rolled everything back) and
  the drafted meta can be deleted to release the name.
- `serveSite()` branches on status: `drafted`/`armed` → loader page;
  `armed` + any visit → promote first (R2 list `draft/` prefix, copy to live
  keys, delete drafts, meta → `published`), then serve; `published`/absent →
  serve as today.

*Verify:* deploy → subdomain serves loader and `artifact.json` 404s; confirm
with a bad token → error page, still loader; good token → armed; first visit →
content serves and `draft/` is gone; second visit is a plain serve; legacy
sites (no status) unaffected.

### 2. Session-authed Worker surface

- Cookie parsing + `requireSession(request)` helper: reads the cookie, calls
  core `GET /v1/sessions/me` (cache positive results ≤60s per token in memory),
  returns account + owned sites.
- Authorization update on artifact/embed `PUT` and `GET /api/sites/<site>/list`:
  accept **either** the claim-token bearer (as today) **or** a session cookie
  whose account owns the site.
- `GET /api/me` → `{ email, sites }` from the session (401 without one).
- `POST /api/sites` (claim) with a session cookie present: claim as today
  **plus** bind ownership via core `POST /v1/site-ownership` (session bearer).
  Claimed-with-session sites are immediately `published` on first publish, as
  now — the funnel's deferred path is only for anonymous deploys.
- `POST /api/register { email }` → core `POST /v1/confirmations` with no
  subdomain (flow 1's entry).
- `GET /api/dev/mailbox` — proxy of core `/v1/dev/confirmations`, only when
  the core reports dev mode / non-prod; the local human's and verify script's
  way to grab magic links.

*Verify:* PUT with session cookie of the owner succeeds; other account's
cookie 401/403; `GET /api/me` round-trips; claim-with-session binds ownership
(visible in `/api/me`).

### 3. Editor UI affordances (edit page)

- **Deploy modal** (anonymous, no claimed site): Publish → modal with
  subdomain field (availability check) + email field → `POST /api/deploys`
  with the current artifact + generated embed modules → editor shows the
  "check your email" loader state (with a dev-mode link to `/dev/mail`).
- **Register button** on the claim/picker screens → email field →
  `POST /api/register` → "check your email" note.
- **Post-publish modal** for claimed/owned sites: after a successful publish
  show (a) the subdomain link, (b) per component instance, the two-line embed
  snippet with a copy button — moving what `register-test-client.mjs` prints
  into the UI.

*Verify:* covered end-to-end by item 6; component-level check that the modal
snippet matches the served embed URL.

### 4. Dev mailbox page

`/dev/mail` (dev builds only): lists pending confirmations from
`/api/dev/mailbox` with clickable confirm links. One small static page; this is
what makes the whole funnel locally testable without an email provider.

### 5. Dashboard v0

`/dashboard/` (new page in the app build, session-gated via `/api/me`):

- Signed-out → register form (flow 1 entry).
- Signed-in → email + owned sites. Per site: namespace contents via the
  existing `list()` (session-authed), links: **Edit page**
  (`/edit/?site=X`), **Customize Stripe component**
  (`/edit/?site=X&component=payments/StripePayment`), **Get embed code**
  (snippet modal), **Open site**, plus **Claim a new site**.
- No teams, no keys, no orders — this is the FUNNEL/DASHBOARD v0 slice only.

*Verify:* item 6 asserts the dashboard reflects exactly the session's sites
and that its deep links open the editor on the right target.

### 6. End-to-end verify — the milestone gate

`scripts/verify-funnel.mjs` (Playwright; SKIPs unless vite + wrangler + local
core with `CORE_SERVICE_KEY`/`CONFIRM_URL_BASE` are up — document the
`dev-up.sh` recipe at the top):

1. **Flow 2:** edit anonymously → Deploy modal (subdomain + email) → editor
   shows loader; subdomain serves loader; fetch magic link from
   `/api/dev/mailbox`; open it → confirmed page + cookie; visit subdomain →
   loader flips to content (poll, no reload); dashboard lists the site.
2. **Flow 1:** register a second email → dashboard → claim a site → customize
   the Stripe component → publish → snippet modal; paste the snippet on the
   foreign-origin harness page → component renders with the styling.
3. **Isolation/negatives:** account B's cookie cannot PUT to A's site; reused
   confirmation token rejected; unconfirmed deploy still serves only loader;
   confirming a deploy whose subdomain was meanwhile claimed by another
   account → the `site_owned` page, no cookie set.
4. Wire into `verify-all.mjs` (SKIP cleanly when core absent, matching
   `verify-core-identity.mjs` house style).

## Sequencing note (cross-plan dependency)

No stubs. The state machine, loader, and promote-on-visit don't touch core and
are directly testable. The deploy endpoint's single core call behaves like
`proxyCore` when core is unconfigured — `503 Core unavailable` — and the
verify SKIPs when core is absent (house style). Everything session-shaped
(items 2, 4–6) runs against the real local core via the repo-root
`scripts/dev-up.sh` once
`core/PLAN_FUNNEL.md` lands. Build order: Worker state machine first, UI next,
session surface once core is up, verify last.
