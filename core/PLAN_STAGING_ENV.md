# Core plan: staging environment (the current deployment becomes staging)

Companion doc: `archura-editor/docs/PLAN_STAGING_EDITOR.md` (worker vars, badge,
Cloudflare steps). Do not implement until Igor says go. Igor deploys and makes
all Cloudflare/DNS/box changes; Claude never pushes or deploys.

## Shape of the change

There is no prod/staging pair yet. The **existing** deployment (archura.ai +
the Hetzner core) is re-designated as **staging**; a real prod environment is
created later, once Stripe test flows work end to end. So this is a
re-labeling plus isolation hygiene, not a second stack.

Environment contract (agreed with Igor, 2026-07-22):

| Setting            | dev            | staging                      | prod (later) |
|--------------------|----------------|------------------------------|--------------|
| Edge auth          | optional       | **required**                 | required     |
| Database           | optional       | required                     | required     |
| Key namespace      | test           | **test**                     | live         |
| Stripe             | optional/test  | test                         | live         |
| Email              | local outbox   | **real delivery**            | real         |
| Admin API          | enabled        | explicitly configured        | explicit     |
| Rate limits        | off            | off (Env!="prod" skip)       | on           |

`DISABLE_RATE_LIMITS` stays a separate flag (see
`PLAN_RATE_LIMIT_KILL_SWITCH.md`) — staging doesn't need it (limits already
key strictly on `Env == "prod"`), but it must exist before prod does.

## Code changes

1. **`config.Validate`** (config.go:77): accept `"staging"`; staging joins the
   prod branch — `RequireEdgeAuth` forced on, same required-secrets list
   (DATABASE_URL, PLATFORM_ADMIN_KEY, CORE_SERVICE_KEY, …). The https check on
   `BillingPublicOrigin` applies to staging too.
2. **Admin API default** (config.go:41): today `adminAPIEnabled := env != "prod"`,
   which would silently default the admin API **on** in staging. The contract
   says "explicitly configured" — change the default to `env == "dev"` so
   staging and prod both require `ADMIN_API_ENABLED=true` in the box env
   (compose already plumbs it with a `false` fallback).
3. **Stripe key/env contract** (config.go:132): validation currently accepts
   `sk_test_` *or* `sk_live_` in every environment. Enforce now: **dev and
   staging accept only `sk_test_`** — a live key outside prod is always a
   mistake. **Prod temporarily keeps accepting either**: runbook step 2
   deploys this code while the box still runs `ARCHURA_ENV=prod` with the
   current Stripe *test* keys, so a prod-requires-live rule would refuse to
   boot mid-cutover, before the env flips. Tighten prod to live-only when the
   real production environment is created (it will be born with live keys).
4. **`PLATFORM_ADMIN_KEY` joins the namespace contract**: config only checks
   presence (config.go:85), and `authenticatePlatformAdmin` compares by value
   with no prefix check (identity.go:284) — a `_live_` admin key would keep
   working in staging. Add `HasKindForEnv(c.PlatformAdminKey, "adm", c.Env)`
   validation alongside the existing `svc`/`int` checks (config.go:116/119).
5. **`cmd/adminctl`** (main.go:25): accepts only `dev`/`prod` and would fail
   the post-deploy bootstrap on a staging box — accept `staging` (key minting
   already lands in the test namespace for any non-prod env). Update its tests.
6. **`deploy/hetzner/compose.yaml`**: `ARCHURA_ENV: prod` is **hardcoded in
   both the `core` (line 28) and `adminctl` (line 124) services**, so flipping
   the env var alone does nothing. Change both to
   `ARCHURA_ENV: ${ARCHURA_ENV:?Set ARCHURA_ENV in .env}`. The value lives in
   the box's **`.env`** (which compose reads and where POSTGRES_*/keys already
   live) — NOT `release.env`, which holds only `CORE_IMAGE` and is rewritten
   by `release.sh` on every deploy. Update `deploy/hetzner/.env.example` (it
   exists — it's a dotfile) with `ARCHURA_ENV`, staging-oriented example
   values, test-prefixed credentials, and the new database name.
   **Ordering trap:** this makes the variable mandatory, so it must exist in
   the box's `.env` *before* this code deploys — runbook step 0.
7. **Key namespace: no change.** `prefixFor` (auth/keys.go:44) already maps
   every non-prod env to `_test_` — staging gets test credentials for free.
8. **Email: no change** in code. `NewServer` uses the dev outbox only for
   `Env=="dev"`; staging with `CLOUDFLARE_EMAIL_ACCOUNT_ID` /
   `CLOUDFLARE_EMAIL_API_TOKEN` / `EMAIL_FROM` set (compose already requires
   them) gets real Cloudflare delivery — real inbox delivery for Igor's
   `igor.atakhanov+tag@gmail.com` aliases is a staging goal.
9. **Rate limits: no change** (`enforceRateLimits` skips when `Env != "prod"`).
10. **OpenAPI**: `AdminContext.env` enum `["dev","prod"]` → add `"staging"`.
    (The ops badge consuming it is an editor change — companion doc.)
11. **Caddy**: `deploy/hetzner/Caddyfile` already uses `{$CORE_HOSTNAME}` — no
    file change; the hostname moves via the box `.env`. The deployed origin
    certificate's SANs were verified on the box (2026-07-22):
    `*.archura.ai, archura.ai` — covers `staging-core.archura.ai`.

## Credential + data cutover (the consequential part)

Flipping `ARCHURA_ENV` prod→staging flips expected key prefixes live→test.
Everything `_live_`-prefixed becomes inert: the worker's service/internal
keys, all sessions, and every organization's stored `pk_live_`/`sk_live_`
keys. Since all current data is test data, the clean cutover is:

- **Fresh database**: `createdb archura_staging` on the existing Postgres;
  point `DATABASE_URL` at it (old `archura` DB stays untouched as an archive).
  Migrations run at boot as always.
- **Mint test keys** with the existing `cmd/devkeys` tool:
  `PLATFORM_ADMIN_KEY`, `CORE_SERVICE_KEY`, `CORE_INTERNAL_KEY` (all
  `_test_`-prefixed). Box env gets the new values; the worker gets the same
  service/internal values via `wrangler secret put` (companion doc).
- **Staff re-grant**: sign up on staging, then the CI `adminctl` bootstrap (or
  a manual `adminctl grant-staff`) re-grants `PLATFORM_OWNER_EMAIL`.
- **Orphaned R2 blobs clean themselves**: the nightly reconciliation sweep
  asks core about each org id found in R2; every old-DB org now answers
  `exists:false`, so the sweep purges those prefixes within a day. No manual
  R2 cleanup needed — this is the deletion feature working as designed.
  **This is also what makes cutover irreversible after the first sweep** —
  see the runbook's rollback boundary below.

## Cutover runbook (Igor executes over ssh; ordered, with the rollback boundary)

**Disposability decision, stated up front:** the old environment's data is all
test data and is declared **disposable**. The old `archura` database stays as
an archive, but its R2 blobs will NOT be preserved — the first nightly sweep
after cutover (cron `17 4 * * *` UTC) purges every prefix whose org the new
database doesn't know. **Rollback is therefore only clean before that first
sweep runs**; after it, switching back to the archived database would bring
back rows whose published sites no longer exist. If cutover happens close to
04:17 UTC, do it after, or accept the loss.

0. **Before pushing any code**: add `ARCHURA_ENV=prod` to the box's `.env`.
   A no-op today, but code change #6 makes the variable mandatory — without
   this, the CI deploy of step 2 fails its `docker compose config` check
   before the cutover even starts.
1. Cloudflare DNS + route exclusion for `staging-core.archura.ai` (companion
   doc) — safe any time, changes nothing live.
2. Push the core code changes (this plan) — the deployed container still runs
   as prod because `.env` says so.
3. On the box, edit **`.env`** (not release.env), flipping
   `ARCHURA_ENV` to `staging` and setting:
   - `ARCHURA_ENV=staging`
   - `CORE_HOSTNAME=staging-core.archura.ai`
   - `POSTGRES_DB=archura_staging` — **backups follow this variable**
     (`backup-postgres.sh` dumps `$POSTGRES_DB`; so does restore). Leaving it
     at `archura` would keep backing up the archive while staging runs bare.
   - `DATABASE_URL` → the `archura_staging` database
   - new test-minted `PLATFORM_ADMIN_KEY` / `CORE_SERVICE_KEY` /
     `CORE_INTERNAL_KEY` (`cmd/devkeys`)
   - `ADMIN_API_ENABLED=true` (now required explicitly — see code change #2)
   - Stripe stays on test keys; `BILLING_PUBLIC_ORIGIN` stays https;
     Cloudflare email vars unchanged.
4. Create the database (the postgres volume is already initialized, so the
   `POSTGRES_DB` change alone won't). Editing `.env` does not export anything
   into the ssh shell, so resolve the user inside the container:
   ```
   docker compose --env-file .env --env-file release.env \
     exec -T postgres sh -ec 'createdb -U "$POSTGRES_USER" archura_staging'
   ```
5. `./deploy.sh` (the canonical wrapper — it passes
   `--env-file .env --env-file release.env`, which a bare
   `docker compose up -d` does not: `CORE_IMAGE` lives only in release.env)
   → migrations run at boot →
   `curl https://staging-core.archura.ai/healthz` through Cloudflare.
   From this moment the worker's old `_live_` credentials are dead — the site
   is briefly down; that interruption is accepted for staging.
6. Worker: `wrangler secret put` the two new test keys + `npm run deploy`
   with the new `CORE_URL` (companion doc).
7. Smoke checks, in order: sign up (real email arrives at a `+tag` alias) →
   `adminctl grant-staff` (or re-run the CI bootstrap) → sign in → /ops/
   shows the amber **Staging** badge → claim a site → publish → site serves.
8. **Run one backup by hand** (`backup-postgres.sh`) and verify the dump is of
   `archura_staging` and lands offsite — scheduled backups now protect the
   right database.

CI keeps deploying this box on push to master — it is now the staging deploy.
No prod workflow yet, per Igor.

## Tests

- `config`: `staging` accepted; staging missing a required secret → boot
  refused; `RequireEdgeAuth` forced; admin API defaults **off** for staging
  and prod, on for dev, and `ADMIN_API_ENABLED` overrides in every env;
  Stripe prefix contract — `sk_live_` refused in dev and staging; prod
  accepts either for now (the live-only tightening lands with the real prod
  environment); admin-key namespace — a `adm_live_`… `PLATFORM_ADMIN_KEY`
  refused in staging/dev, `adm_test_`… refused in prod, mirroring the
  existing `svc`/`int` checks.
- `adminctl`: accepts `ARCHURA_ENV=staging` (grant-staff runs); still rejects
  unknown env values.
- API: server constructed with `Env: "staging"` — rate limiter never consumes
  (reuse the fake assertion pattern), admin context returns `"staging"`, and a
  `sess_test_`… session authenticates while `sess_live_`… is rejected.
- OpenAPI route-drift test keeps passing with the enum change.
