# Archura

Archura lets people build embeddable web components and full pages in an
in-browser editor, publish them to a subdomain, and embed them anywhere. It has
two deployable pieces:

- **`core/`** — the Go backend: accounts, organizations, email confirmation,
  billing, and the platform-owner admin API. Runs on Hetzner (Docker Compose)
  behind Cloudflare, at `core.archura.ai`.
- **`archura-editor/`** — the Cloudflare Worker `archura-sites`: it serves the
  editor SPA, hosts published sites and embeds from R2, and proxies API calls
  through to core. Runs on Cloudflare at `archura.ai` (and `*.archura.ai`).

```
                 ┌───────────────────────── Cloudflare ─────────────────────────┐
   Browser ────► │  Worker "archura-sites" (archura-editor/workers/…)           │
                 │    • serves the editor SPA (dist/, ASSETS binding)           │
                 │    • hosts published sites + embeds (R2: archura-artifacts)  │
                 │    • /api/* → proxies to core                               │
                 └───────────────────────────────┬─────────────────────────────┘
                                                  │  CORE_URL=https://core.archura.ai
                                    ┌─────────────▼──────────── Hetzner ─────────┐
                                    │  Go core (core/) + Postgres (Docker)       │
                                    │    identity · orgs · billing · /ops admin │
                                    └────────────────────────────────────────────┘
```

## Repository layout

| Path | What it is |
|------|------------|
| `core/` | Go backend. Build/test with `go build ./...` / `go test ./...`. Deploy config in `core/deploy/hetzner/`. |
| `archura-editor/` | Cloudflare Worker + editor SPA. Worker in `workers/site-worker.js`, config in `wrangler.toml`. |
| `e2e/` | End-to-end tests (see `e2e/README.md`). |
| `scripts/` | `dev-up.sh` (full local stack), `deploy-watch.sh`, `git-hooks/`. |
| `docs/` | Architecture and design notes. |
| `Makefile` | Developer convenience targets (deploy watching, hook install). |

## Prerequisites

- **Node** 20+ (`npm`, and `npx wrangler`)
- **Go** 1.24+
- **PostgreSQL** binaries on `PATH` (`initdb`, `pg_ctl`) — local dev runs its own
  throwaway cluster (`brew install postgresql`)
- **Docker** — only needed to *deploy* core, not for local dev
- A Cloudflare account with the `archura.ai` zone and the `archura-artifacts` R2
  bucket — only needed to deploy the Worker

## Local development

One command brings up the entire stack — Postgres, core, the built frontend, and
the Worker (`wrangler dev`):

```sh
cd archura-editor && npm run dev      # = sh ../scripts/dev-up.sh
# or, from the repo root:
sh scripts/dev-up.sh
```

It prints progress as each piece comes up, then the URL:

```
➜  http://localhost:8787/
```

What it starts:

| Service | Where |
|---------|-------|
| Frontend + Worker API (`wrangler dev`) | http://localhost:8787 |
| Go core (`ARCHURA_ENV=dev`, watched by Air) | http://localhost:8080 |
| Postgres (throwaway cluster in `/tmp`) | port 54329 |
| Vite + component watchers | rebuild `dist/` on change |

Notes:

- **Email links land in a local mailbox**, not a real inbox: open
  http://localhost:8787/dev-mail/ to click confirmation links.
- **Optional root `.env`** (git-ignored, sourced by `dev-up.sh`) sets
  `PLATFORM_OWNER_EMAIL` (grants `/ops/` access to that account once it signs up)
  and, if you want billing locally, the `STRIPE_*` group.
- `Ctrl-C` stops the stack; Postgres is left running for fast restarts.

Common commands:

```sh
cd core         && go test ./...            # backend tests (Postgres-backed ones skip without TEST_DATABASE_URL)
cd archura-editor && npm run typecheck      # TS typecheck
cd archura-editor && npm run build          # build the SPA + component modules → dist/
cd archura-editor && npm run verify:all     # full browser + worker verification suite
```

## Deploying core (Hetzner)

**Automated.** A push to `master` that touches `core/**` triggers
`.github/workflows/core-image.yml`, which builds an immutable GHCR image and
deploys that exact image to Hetzner (Docker Compose) via the GitHub `production`
environment. The deploy runs migrations, brings up the containers, and runs
`adminctl bootstrap` (idempotent platform-owner grant).

**First-time setup, secrets, rollback, backups, and the platform-owner flow are
documented in [`core/deploy/hetzner/README.md`](core/deploy/hetzner/README.md)** —
that is the source of truth for the core deploy.

To gain `/ops/` (admin console) access in prod: set `PLATFORM_OWNER_EMAIL` and
`ADMIN_API_ENABLED=true` in the server's `.env`, deploy, then sign up as that
email — the next deploy's `adminctl bootstrap` grants you (self-healing). See
§5b of the deploy README.

## Deploying the Cloudflare Worker (editor + hosted sites)

**Manual** (there is no CI for the Worker):

```sh
cd archura-editor
npm run deploy            # = npm run build && wrangler deploy
```

`wrangler.toml` defines the Worker `archura-sites`, its routes (`archura.ai/*`,
`*.archura.ai/*`), the `ASSETS` binding (`./dist`), and the R2 bucket
(`archura-artifacts`). It talks to core via `CORE_URL=https://core.archura.ai`.

Production secrets are set once with `wrangler secret put` (not in
`wrangler.toml`):

```sh
wrangler secret put CORE_SERVICE_KEY      # transport auth to core
wrangler secret put CORE_INTERNAL_KEY     # per-request auth for machine endpoints
wrangler secret put MODERATION_ADMIN_KEY  # protects the moderation endpoints
```

## Watching deploys from the terminal

The core deploy runs in GitHub Actions; you can follow it without leaving the
terminal (requires the GitHub CLI: `brew install gh && gh auth login`).

Install the git hook once so a push to `origin master` auto-tails its run:

```sh
make install-hooks        # pushing master now background-tails the CI/CD run
```

Or drive it manually:

```sh
make deploy-watch         # push the current branch and tail its run
make watch                # tail the latest run without pushing
make runs                 # list recent runs
```

Skip the hook for a single push with `NO_WATCH=1 git push`.

## Further reading

- [`core/deploy/hetzner/README.md`](core/deploy/hetzner/README.md) — production
  deploy runbook (source of truth for core)
- [`core/README.md`](core/README.md) — core build, tests, and the `adminctl` CLI
- [`docs/`](docs/) — architecture and design notes (auth, editor API, embedding
  model, dashboard, …)
- `CLAUDE.md` / `AGENTS.md` — conventions for AI assistants working in this repo
