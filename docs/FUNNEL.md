# Deploy Funnel — Anonymous → Confirmed → Published → Paid

The growth funnel and its implementation: instant anonymous editing, a deploy that captures
an email before anything goes live, a **lazy publish** triggered by the first visit to a
confirmed subdomain, and **universal expiry** where payment buys persistence + the right to
edit. Same house style as the other docs; grounded in the edge/core split
(`FINTECH_ARCHITECTURE.md`).

## Principles

- **Value before signup.** Editing is instant and anonymous. Email is captured at the
  moment of value (deploy), not before.
- **Nothing serves until confirmed + visited.** The email confirmation *arms* a subdomain;
  the first visit *publishes* it. Abandoned or unconfirmed work never becomes a live page —
  which is the anti-abuse property and defers all publish/serve cost to real engagement.
- **Everything expires by default; payment makes it permanent.** Drafts, unvisited sites,
  and free published sites all have TTLs. Paying removes the expiry *and* unlocks editing.
- **Two revenue streams, kept separate:** the site subscription (persistence + edit) here,
  vs. component transaction fees (Stripe Connect, `STRIPE_COMPONENT.md`). A user may pay
  neither, one, or both.

## State machine

```
Anonymous editor
   │  Deploy: pick subdomain + enter email
   ▼
DRAFTED ───────────── expires ~48h ──▶ deleted, subdomain released
   │  subdomain serves a loader; NOT published
   │  email confirmed  (arms the site + binds it to the account's default organization)
   ▼
ARMED ─────────────── expires ~7d ───▶ deleted, subdomain released
   │  subdomain still serves the loader
   │  ANY visit to the subdomain
   ▼
PUBLISHED ─ free: expires ~30d ──────▶ expired page; pay to restore
   │  moderation scan on promote, then serves the live artifact
   │  owner pays
   ▼
PERSISTENT + EDITABLE   no expiry; edits re-publish immediately
```

The only authentication on the whole path is the email confirmation that arms the site.
Everything downstream is a stateless "is it armed? publish-on-visit" / "is it expired?" check.

## Where each piece lives

- **Editor (frontend):** anonymous editing; Deploy → draft; the "confirm your email" loader;
  on return, the editor opens the published artifact (load-on-open) but gates save/publish
  on payment.
- **Edge Worker:** subdomain reservation + availability; draft storage in R2; serving the
  three states (loader vs published vs expired); the publish-on-visit promote; lazy expiry
  checks on access.
- **Core (Go):** email-confirmation accounts, organizations + memberships,
  organization-owned sites, subscription/payment state, and the
  `expires_at`/`status` records. The security boundary for identity and money.
- **Email:** a transactional provider (Resend/Postmark) for the confirmation link.

## Data model (new/extended)

- `sites` — **`site_id` (permanent, opaque `site_…`, the identity — never reused)**,
  `subdomain` (the *address* — unique among active sites, renamable, releasable),
  `status` (drafted|armed|published|expired), `organization_id` (null until
  confirmed), `draft_ref`, `published_ref`, `created_at`, `confirmed_at`,
  `published_at`, `expires_at`.
- `email_confirmations` — `token_hash`, `site_id`, `email`, `expires_at`.
- `accounts` — `email`, magic-link auth. Accounts own nothing but identity and
  memberships; the subscription attaches to the organization (the billing
  boundary) when phase 4 ships — see `AUTH_ARCHITECTURE.md` vocabulary note.
- Ownership: `sites.organization_id → organizations.id`; an account reaches a
  site only through a membership (`accounts ↔ memberships ↔ organizations`).
  Site and organization counts are unrestricted.

**Identity vs. address** (full doctrine: `AUTH_ARCHITECTURE.md` § Namespaces): the
slug must not be the durable identity, because expiry releases subdomains (phase 5)
and paid users later attach full domains. `site_id` is the durable key; hostnames map
to it. *Implemented at the edge already:* claim and deploy stamp `siteId` into
`sites/<slug>/meta.json`, so every site created since 2026-07-18 carries its
permanent identity ahead of the storage/routing migration.

## Phases

### 1. Anonymous deploy → DRAFTED

**Problem.** Deploy today publishes immediately and (was) gated by an IP allowlist. We want
anonymous instant editing and a deploy that captures email without going live.

**Solution.** Editing stays anonymous (browser state). **Deploy**: choose subdomain → check
availability → create a `drafted` site (store the artifact as `draft_ref` in R2, reserve the
subdomain, `expires_at = now + 48h`) → prompt for email → create an `email_confirmation` +
send the link. The editor shows the "check your email" loader. The reserved subdomain serves
a **loader/placeholder** to any visitor.

**Verify.** Deploy creates a `drafted` site; the subdomain returns the loader, not the
content; no published artifact exists.

### 2. Email confirm → ARMED

**Problem.** Nothing may publish until the owner proves the email.

**Solution.** The email link carries a confirmation token. The core validates it → creates
(or attaches) an account from the email → ensures the account's **default organization**
(created with the account, with its `pk_`/`sk_` key pair and an `owner` membership) →
binds the site to that organization → marks the site `armed` (`confirmed_at`) and extends
`expires_at` to the armed grace (~7d). The confirmation response hands the owner the link
to their subdomain and the organization's publishable key.

**Verify.** A valid token arms the site, creates the account + default organization +
owner membership, and binds the site to the organization; an expired/invalid token is
rejected; the subdomain still serves the loader (armed ≠ published).

### 3. First visit → PUBLISHED (lazy publish)

**Problem.** Publish/serve work should happen only for sites a real visitor reaches.

**Solution.** On any visit to an **armed** subdomain, the Worker promotes: run the moderation
scan on the draft, copy `draft_ref → published_ref`, set `status = published`,
`published_at`, and the free-tier `expires_at` (~30d). Show a brief loader during promote,
then serve. Subsequent visits serve the live artifact directly. "Any visit publishes" is safe
because arming already required the owner's confirmation.

**Verify.** The first visit to an armed subdomain publishes and serves the content; a second
visit serves it fast (already published); a visit to a *drafted* (unarmed) subdomain never
publishes.

### 4. Pay to edit + persist

**Problem.** Free gets one deployed site; editing and keeping it alive should require payment.

**Solution.** The owner returns via magic link and opens the editor with their published
artifact. **Save/publish checks the owning *organization's* subscription** — blocked
(with an upgrade prompt) while the organization is on the free tier, allowed once it
pays; any member with owner/billing permission can be the payer, and the subscription
survives member turnover. Payment also clears `expires_at` (persistence). Members of
paying organizations re-publish immediately (they're authenticated; no lazy dance).

**Verify.** A member of a free organization can open the editor and view but not
save/publish; after the organization pays, save/publish succeeds and the site's
`expires_at` is cleared.

### 5. Universal expiry (lazy)

**Problem.** Drafts, unvisited sites, and lapsed free sites must clean themselves up and free
their subdomains.

**Solution.** **Lazy expiry:** every access (visit, edit, API) checks `expires_at`; past it,
the site is treated as expired — serve an "expired, upgrade to restore" page and stop serving
content. A periodic cleanup job reclaims R2 storage and **releases the subdomain after a
short grace** (so good names aren't squatted by dead free sites); the owning
organization can reclaim during the grace via any of its members. TTLs (all tunable):
draft 48h, armed 7d, published-free 30d,
paid = none. This mirrors the core's existing `ct_` session TTL — "everything has an expiry"
becomes a platform-wide principle.

**Verify.** An unconfirmed draft past 48h is gone and its subdomain reusable; a free site past
its window serves the expired page; a paid site never expires.

**Release frees the address, never the identity.** Reclaiming a subdomain deletes the
hostname mapping and the content; the `site_id` is never reissued. **Prerequisite
before this phase ships:** embed URLs must resolve by stable identity, not the
releasable slug — otherwise a stranger re-registering a released slug would serve
their content through the previous owner's pasted embed code. **Satisfied by the
embed-identity milestone**: embed URLs are `/<pk>/<site_id>/<Component>.js`
(organization key + permanent site id; `docs/PLAN_EMBEDS.md`), with resolution
verifying the site's current metadata still matches — a reused slug's projection
returns 404. Legacy slug-based `/s/<slug>/embed/…` URLs must be retired before
subdomain release actually ships.

## Anti-abuse (falls out of the design)

- No live page exists for unconfirmed/unvisited deploys → spammers can't cheaply spray live
  phishing subdomains.
- Rate-limit drafts per IP; moderation scan runs at promote (only for sites that go live).
- Expiry reclaims junk automatically.

## Build order

1. **Draft/serve states in the Worker** — Deploy → `drafted` + reserved subdomain + loader
   page; no publish. (Reuses R2 + serving; adds the draft state.)
2. **Email-confirm accounts in the core** — confirmations, accounts + default
   organizations + owner memberships, organization-owned sites, the `arm` action;
   transactional email.
3. **Publish-on-visit promote** — Worker promotes armed → published on first visit, with the
   moderation scan.
4. **Lazy expiry** — `expires_at` on sites + on-access checks + cleanup job + subdomain
   release.
5. **Pay-to-edit gate** — subscription state in the core; save/publish checks it; payment
   clears expiry. (Ties to Stripe billing, separate from Connect component fees.)

## Deferred

- **Custom domains (the paid upgrade)** — falls out of identity vs. address: a domain
  upgrade *adds* a hostname → `site_id` mapping row (`www.mikesbakery.com → site_x`)
  alongside the existing subdomain mapping; serving resolves host → site_id →
  namespace. Nothing about the site's content, embeds, or ownership moves. The
  archura subdomain stays as the default/fallback address. Requires: the mapping
  table (core), host-resolution in the Worker ahead of the current subdomain parse,
  and TLS via Cloudflare custom hostnames.
- Multi-page sites, subdomain reclaim UI, composer vs client editing mode, and the
  developer/embed on-ramp (separate funnel for the embeddable components — see
  `STRIPE_COMPONENT.md` and the marketing split).
