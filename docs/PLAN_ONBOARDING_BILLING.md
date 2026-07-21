# Onboarding + Billing Funnel — Target Model (spec, revisit to build)

**Status: target model, not built.** Supersedes the *trial framing* in
`core/PLAN_BILLING.md` (which documents what's currently deployed: a homegrown
30-day trial + subscribe-charges-immediately). The plumbing there — entitlement
lifecycle, Stripe subscription, webhooks, the 60-day recovery cleanup, the
release endpoint — is mostly reused; this changes durations, adds a real Stripe
trial, adds the "design" concept, and adds usage caps.

## Goal

Immediate product experience (no signup wall), a 2-day no-card taste, then
card-captured into a 2-week Basic trial, then paid. No permanent free tier —
pay to continue. Grounded in the reverse-trial + card-at-the-wall research
(`FULLSTACK_COMPONENTS.md` sibling note captured the analysis; Stripe
`trial_period_days` + `trial_will_end` run the card phase).

## The "design" concept (new, first-class)

- **A design is a top-level, embeddable component** — sizes from a card to a
  full splash page. It is *the* embeddable unit. Sub-components inside a design
  (cards within a splash page) are **not** individually embeddable; only the
  top-level design is. "Splash page + 2 standalone cards" = 3 designs.
- **Designs autosave** — editing persists; no manual save-draft step.
- **Deploying a design** gives it a live subdomain (`name.archura.ai`, hosted +
  embeddable). A deployed design is a *subset* of designs: it still counts as 1
  design **and** 1 deploy, not two designs.
- Designs belong to the **organization** (the billing boundary), counted by
  core (the authority for entitlement checks).

## The funnel

| Phase | Trigger / duration | Card | Limits | Owner |
|---|---|---|---|---|
| **0 — Anonymous** | front page | no | build/experience | app |
| **1 — No-card trial** | starts at **first deploy**; **2 days** | no | **1 deploy, 3 designs** | our entitlement system |
| **2 — Basic trial** | card entered; **14 days** | on file, **not charged** | **3 subdomains, 10 designs** | Stripe `trialing` (clock/reminder/charge) + our usage caps |
| **3 — Basic (paid)** | trial end; ongoing | charged (~$5/mo) | 3 subdomains, 10 designs | Stripe `active` + our usage caps |

- **Card capture** is the Phase 1→2 boundary: after the 2-day taste (or when
  they hit a wall during it), Stripe Checkout with `trial_period_days=14` saves
  the card without charging; `customer.subscription.trial_will_end` (~3 days
  out) sends the compliant pre-charge reminder; Stripe charges at day 14.
- **Usage caps are always ours** — Stripe only owns the *time* dimension; it
  cannot express "3 subdomains / 10 designs." Every phase enforces caps in our
  code.

## Expiry — no permanent free tier

When the no-card trial lapses (2 days, no card) **or** the paid subscription
lapses/fails: **pause.**

- Serving stops (hosted pages + embeds go dark).
- **Any interaction brings up the paid modal** (non-blocking — closeable).
- **60-day recovery window**: content is retained, restorable by paying.
- After 60 days: content erased, **subdomains released for reuse**.

This maps directly onto the existing lifecycle: entitlement `expired` →
Worker's `billingRecoveryDeleteAfter` (already 60 days) → the internal-keyed
release endpoint (`DELETE /v1/organizations/{id}/sites/{subdomain}`). Reused
as-is; only the pre-pause phase durations change.

## Enforcement UX (the caps)

Non-blocking upgrade modals, closeable:

- **Deploy** past the deploy cap (2nd deploy on free / 4th on Basic) → "start a
  paid account" / "upgrade" modal.
- **New design** past the design cap (4th on free / 11th on Basic) → same modal.

Counts are core-authoritative (org's design count + deployed-subdomain count);
the editor/Worker check before the action and surface the modal.

## What changes from what's built (`PLAN_BILLING.md`)

1. **Homegrown trial 30 → 2 days** (`TrialDuration`, the Postgres deadlines).
2. **Add a real Stripe trial:** Checkout gains `trial_period_days=14`;
   subscribing no longer charges immediately (fixes the flagged behavior). The
   `trial_will_end` reminder path is added (or Stripe's built-in reminder).
3. **Entitlement gains a third phase:** today ~trial→active; becomes
   *no-card-trial (ours) → Stripe `trialing` → `active`*. `OrganizationEntitlementFor`
   already treats `trialing` as full access, so the Stripe phase largely drops in.
4. **Designs become first-class:** per-org design storage (autosaved artifacts),
   a "My designs" surface (≤3 free / ≤10 Basic), and the design-count as a
   core-authoritative number.
5. **Usage caps + modals:** deploy-count and design-count checks with the
   non-blocking upgrade modal.
6. **Plan limits:** free = 1 deploy / 3 designs; Basic = 3 subdomains / 10
   designs (Basic price ~$5/mo, existing `STRIPE_BASIC_PRICE_ID`).

## Work breakdown (when we build)

**Core:**
- Trial duration 30→2 days; entitlement phases.
- Checkout `trial_period_days=14`; `trial_will_end` handling.
- Design + deploy counts per org; a `can_add_design` / `can_deploy` entitlement
  surface the Worker/editor query before acting.

**Editor / Worker:**
- Designs as first-class autosaved artifacts; per-org storage; "My designs".
- Deploy = bind design → subdomain (existing site path), gated by the deploy cap.
- Non-blocking upgrade modals on cap hits.
- Card-capture flow at the Phase 1→2 boundary (Stripe Checkout with trial).

**Reused unchanged:** the 60-day recovery cleanup, the release endpoint, the
webhook ledger, the entitlement `expired`/`grace` handling.

## Open / deferred

- Exact "design" storage location and schema (implementation detail).
- Whether Phase 1 ties to first deploy for *anonymous* users too (they have no
  org yet — the clock realistically starts once the org exists at confirm).
- Annual plan / higher tiers (later).

## References

- `core/PLAN_BILLING.md` — the currently-deployed billing contract (reused
  plumbing).
- Stripe: `trial_period_days`, `customer.subscription.trial_will_end`, trial
  compliance (pre-charge reminder is required, not optional).
- `AUTH_ARCHITECTURE.md` — org = billing boundary; usage caps are org-scoped.
