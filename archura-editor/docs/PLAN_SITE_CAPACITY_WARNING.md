# Editor plan: warn signed-in users before a doomed publish

Companion doc: `core/PLAN_SITE_CAPACITY_SIGNAL.md` (the
`site_slots_remaining` field this consumes — core lands first). Igor deploys.

## Why

The site-limit failure currently surfaces at the worst moment (after the
confirmation email; honest 409 page, but late). For signed-in users the
answer is knowable the moment a site-creating form opens. Deliberately NOT a
debounced email check: anonymous emails stay unprobeable (account
enumeration), and signed-in users need no email typed at all — the session
already knows the account.

## Change

1. **Worker**: none expected — `/api/me` passes core's session body through,
   so the new field flows automatically. Verify that in the test, don't
   assume it.
2. **UI, on open (not debounced)** of the two site-creating surfaces:
   - the deploy modal (`showDeployModal`, edit/funnel-ui.js)
   - the claim screen (`showClaimScreen`, edit/index.html)
   If `/api/me` succeeds and the **default organization** (the one funnel
   confirmation and claims bind) reports `site_slots_remaining === 0`, show
   a warning above the form: "Your plan has no site slots left — publishing
   will fail. Open your account to upgrade, or remove a site you no longer
   need." Link to `/account/`. Do not disable the form (the signal is
   advisory; billing state can change between open and submit, and the
   confirm/claim path remains the authoritative check with honest errors).
   `null` (exempt) and missing field (older core) → no warning.
   Anonymous visitors (no session) → no check, no requests beyond the
   existing ones.
   **Scope (per core review): this warning is capacity-only.** A read-only
   organization (billing grace/expired) can report slots > 0 and still fail
   to publish — that is `billing.can_edit`'s axis, already surfaced by the
   editor's existing billing notices, not this warning's job.
3. **Copy nuance**: slots > 0 → nothing. Only the 0 case warns — this is a
   failure preemption, not a quota meter.

## Tests

- verify-ops-panel style (stubbed `/api/me`): slots 0 → warning visible with
  the account link; slots 1 → no warning; anonymous (401) → no warning;
  field absent → no warning.
- Worker suite: `/api/me` passthrough includes `site_slots_remaining` when
  core's stub sends it (pins change #1's assumption).
