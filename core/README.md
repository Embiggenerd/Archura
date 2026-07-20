# Archura Core Server (Go)

The regulated system-of-record and authorization server. Sits behind the Cloudflare Worker
edge. Design & roadmap: `../docs/CORE_SERVER.md`.

## Run locally

```sh
# Without a database (scaffold mode): /healthz works, /readyz reports no_database
go run ./cmd/server

# With Postgres: connects, runs migrations, /readyz becomes ready
DATABASE_URL="postgres://user:pass@host:5432/archura" go run ./cmd/server
```

- `GET /healthz` — liveness (process up).
- `GET /readyz` — readiness (database reachable).
- `GET /docs` — interactive Swagger UI for every current API operation.
- `GET /openapi.json` — deployable OpenAPI 3.1 contract.

The OpenAPI document is embedded in the Go binary, so the deployed container and local
server expose the same contract. A route-drift test fails when a health or `/v1` operation
is added to chi without being documented.

## Config (env)

| var                  | default | notes                                  |
|----------------------|---------|----------------------------------------|
| `PORT`               | `8080`  | listen port                            |
| `METRICS_PORT`       | `9091`  | internal Prometheus listener           |
| `ARCHURA_ENV`        | `dev`   | `dev` \| `prod`                        |
| `DATABASE_URL`       | —       | Postgres; empty = scaffold mode        |
| `PLATFORM_ADMIN_KEY` | —       | gates client-onboarding endpoints (M1) |
| `CORE_SERVICE_KEY`   | —       | authenticates the Worker to core       |
| `CONFIRM_URL_BASE`   | —       | dev magic-link target (for example, `http://localhost:8787/confirm`) |
| `REQUIRE_EDGE_AUTH`  | `false` | enables production-like edge auth locally |

Production requires the database, admin key, and an environment-matched `svc_live_...`
service key and exits before listening if any are missing. Development keeps the database
and edge authentication optional.

Generate a random local admin key instead of committing one:

```sh
go run ./cmd/devkeys
# PLATFORM_ADMIN_KEY=adm_test_...

go run ./cmd/devkeys service
# CORE_SERVICE_KEY=svc_test_...
```

Generate a standalone publishable key for component fixtures:

```sh
./scripts/create-publishable-test-key.sh
# PUBLISHABLE_KEY=pk_test_...
```

This standalone key is not registered to an organization. For API requests, use the publishable
key returned by `POST /v1/clients`, which has a corresponding database record.

Start the server with that value in your environment. `POST /v1/clients` then returns a
`pk_test_...` publishable key and an `sk_test_...` organization secret. Component sessions minted
through `POST /v1/component-sessions` return short-lived `ct_test_...` bearer tokens. Test
keys are generated randomly and are valid only when their hashes exist in the local database.

## Client and component identity API

- `POST /v1/clients` — legacy platform-admin endpoint; creates an organization and returns its
  publishable and secret keys. The secret is returned once and stored only as a hash.
  An optional `edge_claim_token` binds the organization slug to its edge content namespace;
  the credential is stored but never returned.
- `POST /v1/components` — organization-secret authenticated; creates a `cmp_test_...` component
  identifier and stores its Stripe Price, mode, redirect URLs, and allowed origins.
- `PUT /v1/components/{componentID}` — updates an existing organization-owned component.
- `POST /v1/component-sessions` — organization-secret authenticated; returns a 10-minute bearer
  token bound to the organization, component, `checkout:create` scope, audience, and origin.

Send credentials through `Authorization: Bearer <key>`. Component IDs use the
`cmp_test_...` form in development and `cmp_live_...` in production. Production origins
must use HTTPS; local development may use HTTP.

In production, `/v1/*` additionally requires the Worker-owned
`X-Archura-Service-Authorization: Bearer svc_live_...` header. For local direct calls it is
disabled by default. Set `REQUIRE_EDGE_AUTH=true` with a generated service key to exercise
the production boundary locally.

The Worker proxies `/api/core/v1/*` to core, removes caller-supplied service/client-IP
headers, and adds its own. Put `CORE_SERVICE_KEY` in Wrangler secrets (or `.dev.vars`
locally); set `CORE_URL=http://127.0.0.1:8080` in `.dev.vars` for a local Worker→core stack.

## Account and site ownership API

- `POST /v1/confirmations` — service-authenticated; creates a one-hour,
  single-use email confirmation. The normalized email, optional subdomain,
  and token hash are stored in Postgres. Development responses also include
  the confirmation URL.
- `POST /v1/confirmations/verify` — service-authenticated; atomically consumes
  a confirmation, creates or reuses the account and its default organization,
  binds the optional site to that organization, and returns a seven-day
  `sess_...` account session once.
- `GET /v1/sessions/me` — account-session authenticated; returns the current
  account, organization memberships, organization publishable keys, and sites.
- `POST /v1/organizations` — account-session authenticated; creates another
  organization with an owner membership and returns its secret key once.
- `POST /v1/sessions/logout` — best-effort account-session revocation. It
  always returns 204 for missing, unknown, expired, or already-revoked session
  tokens so the Worker can clear its cookie unconditionally.
- `POST /v1/site-ownership` — account-session authenticated; binds a subdomain
  to a selected organization (or the default organization when omitted).
  Rebinding to the same organization is idempotent; another organization
  produces `site_owned`. Site counts are unrestricted.
- `GET /v1/dev/confirmations` — development only; lists the 50 most recent
  magic-link messages from the process-memory delivery outbox. Used and expired
  messages remain visible with state flags until eviction or restart. The outbox
  never writes plaintext tokens to Postgres.

All five routes still require the Worker service credential when edge
authentication is enabled. Account-session routes additionally use
`Authorization: Bearer sess_...`. Development confirmation creation requires
`CONFIRM_URL_BASE`; production deliberately omits `confirm_url` while the real
transactional-email delivery implementation remains out of scope.

## Observability and maintenance

- Every request emits a structured JSON access log with its route pattern, status, latency,
  request ID, and authenticated organization/component identifiers.
- Authentication failures are counted on every attempt and security logs are sampled once
  per `(client IP, reason)` per minute.
- Prometheus metrics are served separately at `http://localhost:9091/metrics`.
- Client, component, and component-session writes create allowlisted audit rows in the same
  database transaction.
- Production requests use PostgreSQL-backed organization and confirmation rate limits;
  development bypasses them even when edge authentication is enabled. The Worker
  adds a coarse production front-door limit.

Run retention cleanup from a scheduler or manually:

```sh
DATABASE_URL="postgres://..." go run ./cmd/maintenance
```

This removes account confirmations and sessions after use, expiry, or revocation,
and removes component sessions and fixed-window rate-limit buckets after their
24-hour retention period. It does not run as a goroutine in web machines.

## Test

```sh
go test ./...                                   # unit tests (no DB)
TEST_DATABASE_URL="postgres://..." go test ./... # includes migration tests
```

## Migrations

Versioned SQL in `internal/store/migrations/*.up.sql`, applied on boot in filename order by
a small transactional runner (`store.Migrate`). Add a new file `000N_name.up.sql` (+ a
`.down.sql`) per change.

Migrations currently run before the server starts. If migration time approaches the Fly
health-check grace period, move them to a release command rather than increasing startup
uncertainty.

## Deploy

The recommended single-server deployment uses Docker Compose, Caddy, and PostgreSQL on
Hetzner. See [`deploy/hetzner/README.md`](deploy/hetzner/README.md) for installation,
firewall, backup, restore, deployment, and rollback instructions. The public Cloudflare
Worker remains the only application caller; Caddy exposes Core through a
Cloudflare-proxied HTTPS hostname without exposing the database or metrics ports.

The earlier Fly.io configuration remains in `fly.toml` as an alternative. For either
target, the Docker build accepts `VERSION`, `COMMIT`, and RFC3339 `BUILD_TIME` arguments;
they appear in startup logs and `/healthz`.
