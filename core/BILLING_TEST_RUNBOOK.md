# Billing Test Runbook — Trial → $5/month, Stripe Test Mode in Prod

How to verify the 30-day trial and recurring $5/month subscription against a
deployed environment, using Stripe **test mode** (no real money moves). Pairs
with `archura-editor/scripts/verify-billing-prod.mjs`, which automates the
scriptable parts; this doc covers the interactive parts it can't.

## Two systems, tested two ways

- **The 30-day trial is Archura-internal** — Postgres deadlines
  (`organization_billing.trial_ends_at`, `serve_grace_ends_at`) that start at
  the org's **first publish**. Stripe is uninvolved. Its trial→grace→expired
  math is covered by `TestOrganizationEntitlementLifecycle` (pure, injected
  clock); to see it live without waiting 30 days, back-date the deadlines
  (step 5).
- **The $5/month is pure Stripe** — a recurring subscription created at
  Checkout. Verify recurrence with a **Stripe test clock** (step 3); real time
  can't be skipped otherwise.

**Behavior to know:** Checkout is `mode=subscription` with **no Stripe-side
trial**, so subscribing charges **$5 immediately** — it does not defer to day
30. Subscribing early forfeits the remaining free days. If that's not intended,
it's a code change (set a Stripe `trial_end` aligned to `trial_ends_at`), not a
test-setup issue.

## Prerequisites (Stripe test mode in prod)

The core config validator accepts `sk_test_`, so test mode runs against the real
prod core.

- Prod `.env`: `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET=whsec_…`
  (from the **test-mode** endpoint), `STRIPE_BASIC_PRICE_ID=price_…` (a $5/mo
  recurring price created in test mode), `BILLING_PUBLIC_ORIGIN=https://archura.ai`.
- Register the webhook in the Stripe **test-mode** dashboard →
  `https://core.archura.ai/stripe/webhooks`, events:
  `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`,
  `invoice.paid`, `invoice.payment_failed`.
- Run `node archura-editor/scripts/verify-billing-prod.mjs` — the webhook check
  must show **CONFIGURED (400)**, not 503. With `STRIPE_SECRET_KEY` +
  `STRIPE_BASIC_PRICE_ID` in env it also confirms the price is recurring
  monthly $5 USD (catches a one-time-price misconfiguration).

## Sequence

1. **Trial grants access, no charge.** Register a fresh org → publish. Dashboard
   Plan shows the 30-day trial; entitlement `can_serve`/`can_edit` true. Stripe
   test dashboard shows **no customer, no charge**. (`verify-billing-prod.mjs`
   with `ARCHURA_COOKIE` reports the plan state.)

2. **Subscribe → immediate $5 → active.** As owner: "Subscribe for $5/month" →
   Checkout → test card `4242 4242 4242 4242`, any future date/CVC. Stripe shows
   a Customer, an active Subscription, and a **$5.00 paid invoice**;
   `checkout.session.completed` + `customer.subscription.created` webhooks land;
   core status → `active`. Watch core logs for webhook 200s and the
   `billing.subscription_updated` audit row.

3. **Recurring month-2 charge (test clock).** Real time can't be skipped. Create
   the customer under a **test clock** (Stripe dashboard or CLI), subscribe, then
   advance the clock ~1 month → second $5 invoice + `invoice.paid` → core updates
   `current_period_end`. (`CreateCustomer` doesn't attach a clock, so splice in a
   clock-attached customer for this one-off.)

4. **Failure & cancel (via the clock).**
   - Declining renewal card (e.g. `4000 0000 0000 0341`) → `invoice.payment_failed`
     → `past_due` → 7-day serving grace (serve yes, edit no) → `expired` (serving
     returns 402).
   - Portal → cancel → `subscription.updated` (`cancel_at_period_end`) → active
     through the paid period → grace → expired.

5. **Trial boundary, live, without waiting.** Back-date one test org:
   `UPDATE organization_billing SET trial_ends_at = now() - interval '1 day',
   serve_grace_ends_at = now() - interval '1 day' WHERE organization_id = '…';`
   → dashboard shows "Subscription required," serving returns 402, editing blocked.

## Gotchas

- **Webhook secret mismatch** is the #1 failure: a wrong/live `STRIPE_WEBHOOK_SECRET`
  makes every event silently 400, so status never updates and the subscription
  looks stuck. Confirm webhook 200s in the core logs right after Checkout.
- **Test mode moves no real money** — everything is in Stripe's test dashboard;
  live would be `sk_live_`.
- **Idempotency:** re-sending a webhook from the Stripe dashboard must not
  double-apply (the `stripe_webhook_events` ledger); confirm no duplicate audit
  rows or state regression.
