# Staging Environment — Build Plan (revisit to implement)

**Status: plan, not built.** How to stand up a staging environment alongside
prod on the same Hetzner box (or a second box), with the two stacks fully
isolated and Caddy routing by hostname. Decided approach, ready to execute
later.

## Decisions (settled)

- **Environments via CI/CD, trunk-based — no environment branches.** One
  `master`; the immutable GHCR image (`git-<sha>`) is the promotable artifact;
  the *same image* is deployed to staging then promoted to prod. Never a merge
  to an environment branch, never a rebuild per environment.
- **Hostnames (flat, not nested):**
  - `staging.archura.ai` → the staging **Worker**.
  - `staging-core.archura.ai` → the staging **core** on the box.
  - Flat is deliberate: a `*.archura.ai` wildcard origin cert and single-label
    proxied DNS both cover `staging-core.archura.ai`; a nested
    `core.staging.archura.ai` would need a separate `*.staging.archura.ai` cert.
- **Two fully separate stacks, Caddy just routes.** `prod/` and `staging/` are
  self-contained folders that share nothing — separate compose, Postgres
  volumes, internal networks. No shared Docker network, no aliases. Caddy is
  pulled OUT of the per-env compose into its own concern and is the only
  public-facing piece.
- **Isolation via loopback ports.** Each env publishes core on a distinct
  `127.0.0.1` port; Caddy (on the host) reverse-proxies by hostname. Cores are
  never publicly bound → the "only Caddy is public" firewall invariant is
  preserved unchanged (Hetzner still allows 443 to Caddy only).
- **Same-box vs second box:** same-box (this plan) is the cheap start and shares
  CPU/RAM/disk (a heavy staging migration can touch prod). A second small
  Hetzner box buys real blast-radius + identical network/firewall/TLS fidelity
  for ~€4-5/mo — preferred once staging is load-bearing, since the failures
  staging exists to catch are environmental. Layout below works either way.

## Target layout

```
/opt/archura/
  caddy/                  # ONLY public-facing piece; binds :443; routes by host
    Caddyfile
    certs/                # *.archura.ai wildcard origin cert (origin.pem, origin-key.pem)
  prod/
    compose.yaml          # core + postgres, self-contained; core → 127.0.0.1:8081
    .env  release.env
  staging/
    compose.yaml          # core + postgres, self-contained; core → 127.0.0.1:8082
    .env  release.env
```

## Work items

### 1. Split core out of the current bundled compose

Today `deploy/hetzner/compose.yaml` bundles Caddy with core (reverse_proxy
`core:8080` on the internal network). Refactor into a **per-env compose**
(core + postgres only), with core published on a loopback port instead of
`expose`:

```yaml
# prod/compose.yaml     core:  ports: ["127.0.0.1:8081:8080"]
# staging/compose.yaml  core:  ports: ["127.0.0.1:8082:8080"]
```

Everything else (postgres, healthcheck, volumes, `${VAR:?}`/`${VAR:-}` env
interpolation incl. the Stripe `:-` group and required `CORE_INTERNAL_KEY`)
carries over unchanged, per env.

### 2. Caddy as the standalone router

Pull Caddy into `caddy/`. It must reach `127.0.0.1:808x` on the **host**, so
either:
- a **host systemd service** (not containerized) — cleanest "router separate
  from both apps"; loopback just works; or
- its own compose with **`network_mode: host`**.

Caddyfile:

```
core.archura.ai          { tls /certs/origin.pem /certs/origin-key.pem
                           @readiness path /readyz
                           respond @readiness 404
                           header -Server
                           reverse_proxy 127.0.0.1:8081 }
staging-core.archura.ai  { tls /certs/origin.pem /certs/origin-key.pem
                           @readiness path /readyz
                           respond @readiness 404
                           header -Server
                           reverse_proxy 127.0.0.1:8082 }
```

(Keeps the existing `/readyz` 404 block and `-Server` header from the current
Caddyfile.) Deployed/managed on its own — it almost never changes.

### 3. `.env.staging` — staging-hostname values wired through

The staging stack must be internally self-referential or environments bleed
(a staging email links to prod, staging webhooks hit prod). Distinct from prod:

- `DATABASE_URL` → staging Postgres (separate volume/creds).
- `CONFIRM_URL_BASE=https://staging.archura.ai/confirm`
- `BILLING_PUBLIC_ORIGIN=https://staging.archura.ai`
- `CORE_SERVICE_KEY`, `CORE_INTERNAL_KEY`, `PLATFORM_ADMIN_KEY` → **own** values
  (do not reuse prod's).
- Stripe test mode with its **own webhook** registered at
  `https://staging-core.archura.ai/stripe/webhooks` → own `STRIPE_WEBHOOK_SECRET`.
- Email: staging sender / same provider, own `EMAIL_FROM` if desired.

### 4. Worker staging environment

`wrangler.toml` gains `[env.staging]` / `[env.production]` blocks:

- staging route `staging.archura.ai/*`; vars `CORE_URL=https://staging-core.archura.ai`,
  `PUBLIC_ORIGIN=https://staging.archura.ai`.
- staging secrets set with `wrangler secret put --env staging …`
  (`CORE_SERVICE_KEY`, `CORE_INTERNAL_KEY`, `MODERATION_ADMIN_KEY`) — matching
  the staging core's values.
- Deploy: `wrangler deploy --env staging` / `--env production`.

### 5. Deploy workflow — promote one image through environments

Split the `deploy` job into `deploy-staging` (auto on merge) and `deploy-prod`
(manual approval gate via a GitHub `production` Environment with required
reviewers). Both deploy the **same** `needs.publish.outputs.image`; they differ
only in target folder (`/opt/archura/staging` vs `/opt/archura/prod`) and, for
the Worker, `--env`. Tailnet SSH path is unchanged.

## Dashboard actions (not code — do by hand)

- **Cloudflare DNS:** proxied A/AAAA `staging-core.archura.ai` → box IP.
- **Worker routes:** ensure `staging.archura.ai/*` maps to the staging Worker;
  and **carve `staging-core.archura.ai` out of the site Worker** the same way
  `core.archura.ai` is excluded (the wildcard `*.archura.ai/*` route otherwise
  swallows it and serves a site page instead of reaching the origin box). This
  carve-out is the easy-to-forget gotcha.
- **Stripe (test mode):** register the staging webhook endpoint; copy its
  `whsec_` into `.env.staging`.
- **Origin cert:** a `*.archura.ai` wildcard origin cert covers both core
  hostnames — reuse it, no per-host cert.

## Gotchas (from the design discussion)

- Wildcard Worker route `*.archura.ai/*` intercepts both new hostnames unless
  handled (staging → staging Worker via more-specific route; staging-core →
  origin carve-out).
- Every staging config value must point at the staging hostnames — the whole
  point of a separate `.env.staging`.
- Loopback (`127.0.0.1`) publish, not `0.0.0.0`, or you break the "only Caddy
  is public" firewall invariant.
- Same-box staging shares resources with prod; a second box removes that risk.
