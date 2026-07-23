# Editor plan: failed confirms land signed-in on the dashboard, told why

> **PARKED (2026-07-23)** with its core companion,
> `core/PLAN_CONFIRM_IDENTITY_FIRST(parked).md`. Unresolved lifecycle
> decisions blocking revival: a retryable refused-bind token is a replayable
> login credential, and `site_owned` has no exit (the token pins the taken
> name; funnel re-entry is blocked by account_exists). Any revival uses
> consume-once + an authenticated pending-draft resume (retry /
> rename-and-publish from the dashboard) — not re-clickable tokens.

Companion doc: `core/PLAN_CONFIRM_IDENTITY_FIRST.md` (verify always mints the
session; site bind is a separately-reported outcome). Core lands first; until
it does, the current honest 409 pages ("Your plan is out of sites" /
"taken in the meantime") remain the behavior and stay as the fallback for
outcome-less responses.

## Flow

`handleConfirm` (site-worker.js), when verify returns a session with a
non-`bound` site outcome:

1. **Every response after a successful verify carries the session cookie —
   every branch, no exceptions** (review blocker #3). `handleConfirm` has
   post-verification logic (notably the component-plan check) whose failure
   branches currently return pages without `Set-Cookie`; under
   identity-first, any such branch silently discards a session core just
   minted. Audit all exit paths after verify; attach the cookie to each,
   including error and 402 pages.
2. Redirect to `/dashboard/?notice=<outcome>`:
   - `site_limit_reached` → `/dashboard/?notice=no-capacity`
   - `site_owned` → `/dashboard/?notice=name-taken`
   - `organization_read_only` → `/dashboard/?notice=read-only`
3. The dashboard reads the `notice` param once and renders a banner above its
   cards, next to the remedies (billing status, upgrade CTA, existing sites).
   Because the token survives refused outcomes (core plan), the copy tells
   the user their draft is recoverable:
   - `no-capacity`: "Your site wasn't published — your plan has no capacity
     for another site. Upgrade or remove a site you no longer need, then
     click the link in your email again — your draft is saved."
   - `name-taken`: "Your site wasn't published — that name is owned by
     another account. Head back to the editor and pick another name."
   - `read-only`: "Your site wasn't published — this organization is
     read-only until its billing is fixed. Sort out billing below, then
     click the link in your email again — your draft is saved."
   Unknown notice values render nothing (forward compatibility). The param
   is stripped from the URL after rendering (history.replaceState) so a
   refresh doesn't re-scold.

The drafted content stays staged under the reservation, and the confirmation
link stays valid within its TTL for refused outcomes — re-clicking it after
fixing the refusal completes the original publish. Past the TTL, behavior is
today's: the reservation ages out via the sweep.

## Explicitly rejected (Igor, 2026-07-23)

Hiding the anonymous Deploy button from signed-in users. Signed-in users may
reach the funnel in odd ways and that is fine; the invariants are that plan
boundaries hold (core's bind guards, untouched) and that every refusal states
its real reason (this plan + the modal-time `account_exists` message). Do not
re-litigate with cleverness.

## Tests

- Worker suite: verify-response stubs for all four outcomes —
  `bound` → today's redirect unchanged; `site_limit_reached` → 302 to
  `/dashboard/?notice=no-capacity` WITH the session Set-Cookie;
  `site_owned` → `?notice=name-taken` with cookie; `organization_read_only`
  → `?notice=read-only` with cookie; outcome field absent (old core) →
  current 409 pages (fallback pinned). Additionally: **every**
  post-verification failure branch (component-plan check included) carries
  the session Set-Cookie — assert on the failure pages, not just redirects.
- Browser (panel-style, stubbed `/api/me`): each notice renders its banner
  (no-capacity shows the re-click-your-link copy); unknown notice renders
  nothing; refresh after render shows no banner (param stripped).
