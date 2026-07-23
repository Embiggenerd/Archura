# Core plan: confirmation verify is identity-first — sessions never roll back

Companion doc: `archura-editor/docs/PLAN_CONFIRM_DASHBOARD_LANDING.md`.
Igor's decisions (2026-07-23): signed-in users are NOT blocked from reaching
the anonymous deploy in odd ways — no button-hiding, no cleverness. The two
invariants that matter instead: **a user can never cross a plan boundary**,
and **when something doesn't happen, they are told the real reason**. This
plan makes the second invariant structural at the confirm step.

## The semantic change

Today `VerifyConfirmation` is all-or-nothing: if the site bind fails
(capacity, or name owned by someone else), the whole transaction rolls back —
**including account upsert and session creation** — and the user who just
proved they own the email ends up with no session, staring at an error page
with no signed-in remedy available.

New rule: **clicking a valid confirmation link proves identity, and identity
never rolls back.** Verify always upserts the account and mints the session;
the *site bind* is a separately-reported outcome:

- bind succeeded → response as today (session + site bound).
- bind hit the plan limit → session + outcome `site_limit_reached`.
- name owned by another organization → session + outcome `site_owned`.
- organization is read-only (billing grace/expired → `ErrReadOnly`) →
  session + outcome `organization_read_only`. This refusal exists on the
  bind path and MUST be an outcome like the others — otherwise identity
  rolls back on exactly the accounts most in need of reaching their billing
  page, or they get a wrong explanation.

**Token consumption follows the outcome (review blocker #1):** the token is
consumed only on `bound`. On every refused outcome it stays valid within its
TTL — that preserves today's recovery path, which the first draft of this
plan silently destroyed: fix the refusal (upgrade, free a site, rename), then
**click the same confirmation link again** and the staged draft publishes.
The draft strands only when the TTL lapses first, which is exactly today's
behavior, and the reservation then ages out via the sweep.

Suggested envelope: HTTP 200 for all outcomes (identity verification DID
succeed; the enum answers "what happened to the site") — e.g. an added
`"site_outcome"` field with the session fields always present. Exact shape is
the core model's call; the Worker contract needs: session always present on a
valid token, outcome distinguishable, token consumed on `bound` only.

## What must NOT change

- **Plan boundaries stay uncrossable**: the bind's guarded INSERT and limit
  checks are untouched — this plan changes what happens *around* a refusal,
  never whether it refuses.
- Invalid/expired/used tokens: unchanged (no session, current errors).
- Audit: `site_ownership.rejected` still fires on the refused bind;
  `account.created` / `session.created` now also fire in those cases,
  truthfully, since those things now actually happen.
- The no-subdomain (sign-in) flavor: no change — it already has no bind.

## Tests

- Valid token + capacity-full org → account exists after, session valid
  after, NO `organization_sites` row, outcome `site_limit_reached`, and the
  token is **still valid**: after raising the limit, a second verify of the
  same token binds the site (the retry path, pinned).
- Valid token + name owned by another org → same shape, outcome
  `site_owned`, the other org's binding untouched, token retryable.
- Valid token + read-only org → session minted, outcome
  `organization_read_only`, no bind, token retryable.
- Valid token + room → binds, token consumed (second verify fails as a used
  token), byte-compatible with today's success apart from the additive field.
- Expired/used token → no account, no session (identity-first does not mean
  token-optional).

## Interaction with PLAN_FUNNEL_EXISTING_EMAIL

Unchanged and complementary: creation-time `account_exists` still turns
already-registered emails away at the modal. The accepted race (email
registered between create and verify) now lands even more gracefully — the
user is signed in and their site binds into their fresh account, or they get
the dashboard with the true reason (companion doc).
