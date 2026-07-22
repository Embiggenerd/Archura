# Core plan: rate-limit kill switch for prod testing

Do not implement until Igor says go. Igor deploys; Claude never pushes or
deploys.

## Why

Igor tests sign-up/sign-in/deploy flows against production and gets locked out
by the confirmation limiter ("Too many attempts", an hour-long 429). The
per-IP limit was already loosened (5→30/hour, `confirmationIPRateLimit`), but
testing needs a way to turn limits **off** entirely, then back on.

## Existing shape (verified 2026-07-22) — this is a one-condition change

Every core rate limit goes through a single choke point:
`enforceRateLimits` (api/rate_limit.go:28). All six call sites — confirmation
create (email+IP), invitation create, client create, component write ×2,
component-session create — use it, and it **already returns early when
`cfg.Env != "prod"`** (dev is frictionless today; Igor's pain is prod-only).
Do not add per-endpoint flags or exemption lists — extend the choke point.

## Design

### 1. Config: `DISABLE_RATE_LIMITS`

- New `config.Config` field `DisableRateLimits bool`, parsed from the
  `DISABLE_RATE_LIMITS` env var (`"true"` → on), default **off**. Follow the
  existing config parsing conventions in `internal/config`.
- `enforceRateLimits` gains one condition alongside the dev skip:

  ```go
  if s.cfg.Env != "prod" || s.cfg.DisableRateLimits {
      return true
  }
  ```

- **Loud at boot, visible while on:** when the flag is set with
  `Env == "prod"`, log one WARN at startup ("rate limits are DISABLED in
  prod") from `cmd/server/main.go` (or NewServer). Do not refuse to boot —
  turning it on in prod briefly is precisely the use case.

### 2. Toggling in production

No API, no DB state, no admin-console toggle — the flag is an env var on the
Hetzner box: add/remove `DISABLE_RATE_LIMITS=true` in the release env used by
`core/deploy/hetzner/compose.yaml` and restart the core container. Document
that in the config's comment. (Deliberately rejected: a runtime admin toggle —
mutable security state and another endpoint for a single-operator prototype;
an owner-email exemption list — machinery the single choke point makes
unnecessary.)

### 3. Clearing an existing lockout

Turning the flag on does not erase counters already accumulated; when the flag
comes back off, a locked IP stays locked until its window lapses. Add an
`adminctl clear-rate-limits` subcommand (`DELETE FROM rate_limit_buckets`,
print rows deleted) so a lockout can be cleared without waiting the hour —
useful immediately, before this feature even ships, via ssh.

## Not in scope

The Worker's `CORE_RATE_LIMITER` binding (60 req/min per IP per operation,
site-worker.js `rateLimitRequest`) is a separate, editor-side limiter. It only
bites above 60 requests/minute, which manual testing doesn't reach. If it ever
does, that's an editor change (`.dev.vars`/env gate in `rateLimitRequest`),
not core.

## Tests

Existing limiter tests construct servers with `Env: "prod"` to get 429s (dev
skips); the flag defaults off, so they stay valid. Add:
- `Env: "prod", DisableRateLimits: true` → a request past the limit is NOT
  429'd, and `ConsumeRateLimit` is never called (assert via the fake).
- `Env: "prod"` without the flag → 429 still fires (guards against the new
  condition being inverted).
- adminctl: `clear-rate-limits` empties `rate_limit_buckets`
  (TEST_DATABASE_URL-gated, like the other store-backed tests).

No migration, no OpenAPI change (no API surface is added or altered).
