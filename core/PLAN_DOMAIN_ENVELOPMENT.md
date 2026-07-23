# Core plan: move Core hostnames to envelopment.ai

Scope: the Core API moves to `staging-core.envelopment.ai` now and
`core.envelopment.ai` for a future production deployment. The public app,
confirmation flow, billing returns, email identities, and published
`<my-site>.archura.ai` sites remain on archura.ai.

Companion doc: `archura-editor/docs/PLAN_DOMAIN_ENVELOPMENT.md` covers the
Worker and Cloudflare side. For this split-domain design, only its Core target
and Core DNS/routing steps apply; do not move the public Worker routes or
`ROOT_DOMAIN` away from archura.ai. Igor executes box and dashboard steps;
nothing deploys without him.

Status (2026-07-23): the staging-core DNS record exists; the origin certificate
and box `.env` flip are pending with Igor.

## Core implementation tasks — the complete list

1. **`deploy/hetzner/.env.example`** — one value swap:
   - line 4: `CORE_HOSTNAME=staging-core.envelopment.ai`
   Keep `CONFIRM_URL_BASE=https://archura.ai/confirm`,
   `EMAIL_FROM=hello@archura.ai`,
   `PLATFORM_OWNER_EMAIL=owner@archura.ai`, and
   `BILLING_PUBLIC_ORIGIN=https://archura.ai`.
2. **`fly.toml`** — keep it unchanged. Its `CONFIRM_URL_BASE` and `EMAIL_FROM`
   values correctly remain on archura.ai even though the obsolete Fly
   deployment is not used.
3. **`BILLING_TEST_RUNBOOK.md`** — update only the Stripe webhook host to
   `staging-core.envelopment.ai`; the app origin remains archura.ai.
4. **No Go changes.** Every runtime hostname in core is configuration
   (`CORE_HOSTNAME` via Caddy, `CONFIRM_URL_BASE`, `EMAIL_FROM`,
   `BILLING_PUBLIC_ORIGIN`); nothing in `internal/` references the domain.
   Test fixtures using archura.ai addresses (`config_test.go`,
   `email_delivery_test.go`) are inert — leave them. `go build ./... &&
   go test ./...` must stay green (the changes are non-code, so this is a
   no-regression check, not a feature test).

## Box `.env` changes (Igor, at cutover — mirrors the example)

Change only `CORE_HOSTNAME=staging-core.envelopment.ai`. Leave
`CONFIRM_URL_BASE`, `EMAIL_FROM`, `PLATFORM_OWNER_EMAIL`, and
`BILLING_PUBLIC_ORIGIN` on archura.ai. A future production Core deployment
uses `CORE_HOSTNAME=core.envelopment.ai`.

## Certificates (Igor, on the box)

Install the new Cloudflare Origin CA cert covering
`envelopment.ai, *.envelopment.ai` at `/etc/caddy/certs/origin.pem` +
`origin-key.pem`, then restart Caddy. The wildcard covers both the one-level
`staging-core.envelopment.ai` and `core.envelopment.ai` hostnames.

## Stripe (Igor, dashboard, test mode)

Webhook endpoint → `https://staging-core.envelopment.ai/stripe/webhooks`.
`BILLING_PUBLIC_ORIGIN` remains `https://archura.ai`, because Stripe Checkout
and portal sessions return users to the public app rather than to Core.

## Explicitly unaffected

The database's archura.ai origins and URLs remain valid because the public app
and published sites stay on that domain. CI/CD (deploys over Tailscale by
address, not domain), R2 keys, Tailscale/ssh, and backups are also unaffected.

## Smoke checks after cutover (with the companion doc's)

`curl https://staging-core.envelopment.ai/healthz` through Cloudflare →
sign-up email arrives from the existing sender → confirm link points at
archura.ai and signs in → publish a site at `<my-site>.archura.ai` → Stripe
test checkout returns to archura.ai and the new Core webhook shows 2xx in the
Stripe dashboard.
