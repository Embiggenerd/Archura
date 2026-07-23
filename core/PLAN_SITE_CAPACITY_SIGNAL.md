# Core plan: expose site capacity in the session payload

Companion doc: `archura-editor/docs/PLAN_SITE_CAPACITY_WARNING.md` (where the
signal is shown). Igor deploys.

## Why

A signed-in user whose organization is at its site limit can build a page,
enter the funnel, receive a confirmation email, click it — and only then
learn the publish fails (`site_limit_reached`). The confirm page is honest
now, but the failure should be visible *before* any of that. The client
cannot compute "can this org add a site" itself: the effective limit is
plan-aware (free vs paid) plus `caps_exempt`, evaluated in the store
(`bindOrganizationSite`'s guarded INSERT, organizations.go:373;
`TestSiteCapUsesFreeAndPaidLimits`). Only core can answer without the client
reimplementing plan logic that will drift.

## Change (rev 2 — incorporates core-model review)

Add one field to each organization in `GET /v1/sessions/me` **only**:

```json
"site_slots_remaining": 0        // int; null when caps-exempt (unlimited)
```

Three decisions the review forced, now explicit:

1. **Session-only, not the shared serializer.** `organizationResponse`
   (accounts.go:616) also serves confirmation-verify and organization-create
   responses; adding the field there would emit uncomputed zeros on paths
   that don't compute it. Enrich the organizations *in the session handler*
   (wrapper adding the key after `organizationResponse`, or a
   session-specific serializer), and give OpenAPI a session-specific
   organization schema (e.g. `allOf` extension) — do NOT touch the shared
   `Organization` schema.
2. **The signal is strictly capacity; read-only is a separate axis.**
   `effectiveResourceLimitsTx` returns `ErrReadOnly` for grace/expired
   billing before yielding limits — calling it naively would 500 the session
   read for read-only orgs, and pure arithmetic can report `> 0` while a
   bind still fails with `ErrReadOnly`. That is correct and accepted:
   `site_slots_remaining` answers "how many slots", `billing.can_edit`
   (already in the payload) answers "may you write at all". The UI composes
   them.
3. **No bind-path locks in a read endpoint.** The existing helper takes
   `FOR UPDATE` on the organization row. "Reuse" means extracting the PURE
   limit-selection logic (the paid/free arithmetic; see designs.go:114) into
   a function of data the session handler already holds — billing,
   `caps_exempt`, sites list, one consistent `now` — with the bind path
   calling the same pure function under its own locks. Session reads acquire
   no transactions and no row locks.

Advisory display data throughout; the bind-time guarded INSERT remains the
only authoritative check.

## Tests

- Free plan at limit → 0; below limit → positive; paid plan raises the
  effective limit; `caps_exempt` → null.
- Read-only org (grace/expired billing): session read still succeeds and
  reports arithmetic capacity (no 500, no ErrReadOnly leak).
- Consistency check, **scoped to editable orgs** (`can_edit` true): reporting
  0 → bind returns `ErrLimitReached`; reporting >0 → bind succeeds. (For
  read-only orgs the bind outcome is `ErrReadOnly` regardless of capacity —
  asserted separately, not as a capacity consistency claim.)
- Confirmation-verify and organization-create responses do NOT contain the
  field (pins decision 1).

No migration; purely additive response field on one endpoint.
