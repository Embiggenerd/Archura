# Editor plan: move archura.ai → envelopment.ai

Companion doc: `core/PLAN_DOMAIN_ENVELOPMENT.md` (box env + certs). Igor
performs every Cloudflare/registrar/Stripe step and deploys; Claude never
pushes or deploys. Nothing here can go live until the envelopment.ai zone is
active in Cloudflare.

## Code changes (small — hostnames live in config, not logic)

1. **`wrangler.toml`**:
   - routes → `envelopment.ai/*` and `*.envelopment.ai/*` with
     `zone_name = "envelopment.ai"`
   - `ROOT_DOMAIN = "envelopment.ai"`
   - `CORE_URL = "https://staging-core.envelopment.ai"`
2. **`scripts/await-deployed-version.mjs`**: default `VERIFY_ORIGIN` →
   `https://envelopment.ai`.
3. **Script defaults**: `verify-billing-prod.mjs` CORE/APP origin defaults.
   Cosmetic: the RESERVED comment in site-worker.js names the old wildcard.
4. No worker-logic changes: site serving, embeds, and cookies all derive from
   the request host; R2 keys are host-agnostic; `RESERVED` names
   (`staging-core` etc.) carry over unchanged.

## Igor: Cloudflare + account steps (ordered)

1. **Zone**: already done — envelopment.ai is registered through Cloudflare
   Registrar, so the zone is in the account and Universal SSL for
   `envelopment.ai` + `*.envelopment.ai` is automatic. Just confirm the zone
   shows Active in the dashboard.
2. **Email sending domain — do this first**: onboard `envelopment.ai` in
   Cloudflare Email Service (Email Sending). Because the zone is already on
   Cloudflare, "Add records and onboard" auto-creates the SPF/DKIM records —
   propagation is typically 5–15 minutes, not days. Until it shows verified,
   `EMAIL_FROM` stays on archura.ai (core doc sequencing).
3. **DNS records in the new zone** (Workers routes only receive traffic for
   proxied DNS entries):
   - `@` (apex) → `AAAA 100::` — proxied (dummy origin; the Worker intercepts)
   - `*` → `AAAA 100::` — proxied
   - `staging-core` → `A <Hetzner box IP>` — proxied
4. **Workers Routes**: after the wrangler.toml change deploys, confirm
   `envelopment.ai/*` + `*.envelopment.ai/*` appear on archura-sites; add the
   exclusion route `staging-core.envelopment.ai/*` → worker **None** (same
   bypass pattern as before).
5. **Origin certificate**: SSL/TLS → Origin Server → create a cert for
   `envelopment.ai, *.envelopment.ai`; install on the box (core doc) —
   `staging-core.envelopment.ai` is one level, so no ACM needed, same as
   before.
6. **Stripe** (test mode): update the webhook endpoint to
   `https://staging-core.envelopment.ai/stripe/webhooks`.
7. **Old domain**: no redirects — Igor's call (2026-07-23): nothing points at
   archura.ai, so it simply goes dark at cutover (routes detach; the zone can
   be retired whenever).

## Cutover order

Zone active + email verified (1–2, done) → code changes here + core doc's box
env (deployable together) → `npm run deploy` (routes attach; verify with
`curl https://envelopment.ai/api/version` — the deploy gate's default origin
now points there) → Stripe webhook (6) → smoke: sign-up on envelopment.ai
with a `+tag` alias (real email!), /ops/ badge, claim + publish a site at
`<name>.envelopment.ai`. archura.ai goes dark at the route move — accepted.

Existing sessions are cookie-scoped to archura.ai and simply won't exist on
the new host — everyone signs in again. Published sites keep their R2 data
and re-serve at `<name>.envelopment.ai` immediately; their old
`<name>.archura.ai` URLs work via the redirect for as long as the old zone
keeps its routes.

## Addendum (2026-07-23): split domains — app vs. published sites

Igor's decision after cutover: **envelopment.ai is the app + front page and
the core address; published customer sites live on `<name>.archura.ai`**
(user-content-domain pattern — untrusted published pages can never set or
toss cookies the app receives, and scam content doesn't ride the app's
domain). Implemented:

- wrangler routes: `envelopment.ai/*` (app), `archura.ai/*` +
  `*.archura.ai/*` (sites). Deliberately **no `*.envelopment.ai` route** —
  stray app-domain subdomains don't resolve, the missing wildcard DNS on
  envelopment.ai is a feature, and the staging-core route exclusion is no
  longer needed (harmless leftover if present).
- `ROOT_DOMAIN=archura.ai`, new `APP_ORIGIN=https://envelopment.ai`; the bare
  sites domain 301s to the app.
- `siteUrlFor`/`embedBaseFor` now emit canonical subdomain/embed URLs
  whenever ROOT_DOMAIN is set, regardless of which host the request came
  through (previously they fell back to path URLs off-root — which would
  have silently path-ified every link once the app moved off the root).
- archura.ai is therefore **permanent customer-facing infrastructure again**
  (reverses "goes dark"); its zone keeps the existing apex + wildcard records
  and Universal SSL. Core is unaffected (stores bare subdomains; all its
  config points at the app side).
- Known cosmetic debt: embed snippets minted during the one day sites lived
  on envelopment.ai reference `embed.envelopment.ai` — disposable staging
  data.
