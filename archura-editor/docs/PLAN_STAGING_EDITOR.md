# Editor plan: staging environment (worker + ops badge + Cloudflare steps)

Companion doc: `core/PLAN_STAGING_ENV.md` (env semantics, key cutover, box
env). Do not implement until Igor says go. Igor deploys and performs every
Cloudflare dashboard step; Claude never pushes or deploys.

The existing worker deployment (archura.ai) **is** the staging worker — no
second wrangler environment until a prod stack exists.

## Code changes

1. **`wrangler.toml`**: `CORE_URL` var → `https://staging-core.archura.ai`
   (decided hostname).
2. **Ops badge** (`ops/index.html` `setEnvBadge`): currently two-state
   (`isDev ? 'Dev' : 'Production'`), so staging would masquerade as
   Production. Make it three-state off core's `context.env`: `dev` → slate
   "Dev", `staging` → amber "Staging", anything else → red "Production". The
   host-heuristic fallback (used only when the context call fails) maps
   non-local hosts to "Staging" while no prod exists.
3. **`RESERVED`** (site-worker.js:17): add `'core'`, `'staging'`, and
   `'staging-core'`. Hygiene with teeth: a customer claiming the subdomain
   `core` or `staging-core` would collide with proxied infrastructure
   hostnames under the `*.archura.ai` wildcard.
4. **verify-ops-panel.mjs**: badge assertion for the staging state (stub
   `context` → `{env:"staging"}` → amber "Staging" badge).

## Secrets rotation (Igor, terminal — after core mints test keys)

The core cutover invalidates the worker's `_live_` credentials. In
`archura-editor/`:

```
wrangler secret put CORE_SERVICE_KEY    # new svc_test_… value
wrangler secret put CORE_INTERNAL_KEY   # new int_test_… value
npm run deploy                          # picks up CORE_URL + code changes
```

Order matters: mint keys → update box env + restart core → put worker secrets
→ deploy worker. Between core restart and worker deploy the site cannot reach
core (~minutes); fine for staging.

## Cloudflare dashboard steps (Igor)

**Hostname (decided): `staging-core.archura.ai`.** One level deep, so it is
covered by the existing Universal SSL edge certificate **and** the deployed
origin certificate — whose SANs were verified on the box (2026-07-22:
`*.archura.ai, archura.ai`). No certificate work of any kind.
`core.archura.ai` is proxied (orange cloud); the box serves that origin cert,
which only works behind the proxy.

The overall cutover order — including the rollback boundary set by the
nightly R2 sweep — lives in the core doc's runbook; the steps below are the
Cloudflare-dashboard and worker-side pieces of it.

1. **DNS** → add an `A` record: name `staging-core`, value = the Hetzner
   box's public IP (same as today's `core` record), **Proxied** (orange
   cloud).
2. **Workers Routes** → today's `core.archura.ai` must have an exclusion that
   keeps the `*.archura.ai/*` worker route from swallowing it (a route entry
   for `core.archura.ai/*` with the worker set to **None**). Replicate it:
   add `staging-core.archura.ai/*` with worker **None**. If no such exclusion
   exists for `core.archura.ai`, check how core traffic bypasses the wildcard
   before cutting over and mirror whatever does it.
3. **Verify before removing anything**: `curl
   https://staging-core.archura.ai/healthz` returns ok through Cloudflare
   (after the box env's `CORE_HOSTNAME` is updated and core restarted — Caddy
   answers only for its configured hostname).
4. **Cutover**: worker deployed with the new `CORE_URL` → confirm sign-in and
   /ops/ work end to end → then delete the old `core` DNS record (or leave it
   until prod exists; it's harmless while the box's `CORE_HOSTNAME` no longer
   answers for it — Caddy will refuse the old Host header).

No R2, rate-limiter, or route changes otherwise — the single existing worker,
bucket, and `archura.ai` routes simply *are* staging now. The nightly
reconciliation sweep cleans up R2 blobs orphaned by the fresh staging
database automatically (see core doc).
