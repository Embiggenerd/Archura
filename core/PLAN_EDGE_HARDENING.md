# Core Plan — Inner Auth for Machine-Invoked Endpoints

Companion to `docs/PLAN_EDGE_HARDENING.md` (Worker side, other model's review
finding 2026-07-20). Small and surgical. Doctrine: **the service header is
transport proof only — every endpoint self-defends with principal auth.**
Reachability is never authorization.

## The finding being fixed

`DELETE /v1/organizations/{id}/sites/{subdomain}` (billing-recovery release)
performs no authorization beyond the edge-auth middleware, and hardcodes the
audit actor as `platform_admin/billing_recovery`. Until the Worker's blanket
proxy is removed it is publicly invokable by anyone holding an organization
UUID; even after, it must not rely on reachability.

## Work items

### 1. Internal credential for machine endpoints

- New config `CORE_INTERNAL_KEY` (generate via devkeys pattern; dev-up wires
  it locally; prod `.env`). Required in prod alongside the other keys.
- `DELETE /v1/organizations/{id}/sites/{subdomain}` requires
  `Authorization: Bearer <internal key>`; 401 otherwise. Audit the actor as
  `internal/billing_recovery` — and if a session token is presented instead
  (future admin UI), record the real account.

### 2. Sweep the same commit's machine-shaped neighbors

Under the same lens, decide and enforce for each:

- `POST /organizations/{id}/billing/start-trial` — Worker-invoked before
  first publish. Require the internal key OR an owner session (both are
  legitimate callers). Never bare.
- `GET /organizations/{id}/entitlement` — Worker-invoked at serve time.
  Billing state is mildly sensitive (trial deadlines, subscription status);
  require internal key or a member session.

### 3. Test convention (doctrine enforcement)

Authorization tests for these endpoints run with `RequireEdgeAuth=false`,
proving each self-defends. Add a repo-wide check to the existing route-drift
test style if cheap: every `/v1` route must have at least one test that
exercises its 401/403 path without edge auth.

*Verify:* `go test ./...` green; release/start-trial/entitlement each reject
unauthenticated calls even with edge auth off; Worker (with the internal key
wired) still performs trial-start, entitlement reads, and scheduled release.

## Coordination

The Worker side (other plan) passes `CORE_INTERNAL_KEY` from its secrets on
the three call sites (`startTrial`, entitlement fetch, scheduled release) —
one env var + three headers. Deploy core first (accepting both old and new
behavior is unnecessary: the Worker change is a header addition, ship
together in the normal core-then-worker order).

## Out of scope

- Removing the blanket proxy (Worker plan).
- Any new endpoints, billing behavior changes, or the public-API question
  (`api.archura.ai` — deferred until merchant backends are real).
