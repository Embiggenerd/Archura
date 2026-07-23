# Core plan: move archura.ai → envelopment.ai

Companion doc: `archura-editor/docs/PLAN_DOMAIN_ENVELOPMENT.md` (worker,
Cloudflare steps, cutover order — read that first; this doc is the box/core
half). Igor executes box and dashboard steps; nothing deploys without him.
Status (2026-07-23): editor code changes are landed; email domain onboarded
and verified (SPF/DKIM/DMARC pass); staging-core DNS record created; origin
cert and box `.env` flip are pending with Igor.

## Core implementation tasks — the complete list

1. **`deploy/hetzner/.env.example`** — five value swaps:
   - line 4: `CORE_HOSTNAME=staging-core.envelopment.ai`
   - line 16: `CONFIRM_URL_BASE=https://envelopment.ai/confirm`
   - line 19: `EMAIL_FROM=hello@envelopment.ai`
   - line 34: `PLATFORM_OWNER_EMAIL=owner@envelopment.ai` — only after the
     owner-account handoff below; otherwise keep the existing owner address
   - line 41 (commented Stripe block): `# BILLING_PUBLIC_ORIGIN=https://envelopment.ai`
2. **`fly.toml`** (repo root of core/) — carries `CONFIRM_URL_BASE` and
   `EMAIL_FROM` for a Fly.io deployment that no longer exists (production is
   the Hetzner compose stack). Keep the file, but update its two hostname
   values so it cannot mislead.
3. **`BILLING_TEST_RUNBOOK.md`** — update the app origin and Stripe webhook
   examples to the envelopment.ai staging hostnames.
4. **No Go changes.** Every runtime hostname in core is configuration
   (`CORE_HOSTNAME` via Caddy, `CONFIRM_URL_BASE`, `EMAIL_FROM`,
   `BILLING_PUBLIC_ORIGIN`); nothing in `internal/` references the domain.
   Test fixtures using archura.ai addresses (`config_test.go`,
   `email_delivery_test.go`) are inert — leave them. `go build ./... &&
   go test ./...` must stay green (the changes are non-code, so this is a
   no-regression check, not a feature test).

## Box `.env` changes (Igor, at cutover — mirrors the example)

Same five values. **EMAIL_FROM sequencing**: flip it only after the
envelopment.ai sending domain has verified in Cloudflare Email Service
(DKIM/SPF) — sending from an unverified domain bounces or lands in spam,
which for sign-in links means nobody can log in. Until it verifies, keep
`EMAIL_FROM=hello@archura.ai`; everything else can cut over first.
`CONFIRM_URL_BASE` must flip together with the worker's route change — the
links in sign-in emails point at it.

**PLATFORM_OWNER_EMAIL sequencing**: this value identifies an account; changing
it does not transfer the `platform_owner` role. Email Sending verification is
outbound-only, so first confirm `owner@envelopment.ai` can receive mail through
Email Routing or another mailbox. Then sign up as that address and re-run a
deploy or `adminctl grant-staff` so the role is granted. Until that handoff is
verified in `/ops/`, keep the existing owner address in the box `.env`.

## Certificates (Igor, on the box)

Install the new Cloudflare Origin CA cert covering
`envelopment.ai, *.envelopment.ai` at `/etc/caddy/certs/origin.pem` +
`origin-key.pem`, then restart Caddy. One-level hostname, so no paid cert
tier — identical situation to the archura.ai cert. Keep the old cert files
aside until the old zone is retired if `staging-core.archura.ai` should keep
answering during the transition (Caddy serves one `CORE_HOSTNAME`; if both
hostnames must answer simultaneously, that's a second site block — simplest
is a clean flip and let the old hostname go dark).

## Stripe (Igor, dashboard, test mode)

Webhook endpoint → `https://staging-core.envelopment.ai/stripe/webhooks`.
`BILLING_PUBLIC_ORIGIN` in `.env` must match the new app origin (the https
validation already enforces the scheme).

## Database audit

Before cutover, check persistent `organizations.allowed_origins` plus
`payment_components.success_url`, `cancel_url`, and `allowed_origins` for
archura.ai values. Existing component sessions also carry an audience and
allowed origin, but they are short-lived and can expire naturally. If every
matching organization/component is disposable staging data, record that and
leave it; otherwise update the persistent configuration for envelopment.ai and
include an affected component in the smoke test.

CI/CD (deploys over Tailscale by address, not domain), R2 keys, Tailscale/ssh,
backups, and the remaining database data are unaffected.

## Smoke checks after cutover (with the companion doc's)

`curl https://staging-core.envelopment.ai/healthz` through Cloudflare →
sign-up email arrives from the new domain (inbox, not spam) → confirm link
points at envelopment.ai and signs in → Stripe test checkout completes and
the webhook shows 2xx in the Stripe dashboard.
