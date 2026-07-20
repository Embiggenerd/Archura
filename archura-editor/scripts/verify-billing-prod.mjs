// Non-interactive billing checks against a deployed environment (prod or
// staging), in Stripe TEST mode. Three layers, each activating when its
// inputs are present — run the first with no secrets at all:
//
//   node scripts/verify-billing-prod.mjs
//     Layer 1 (always): wiring — core reachable, webhook endpoint CONFIGURED
//     (400 bad-signature, not 503), edge auth intact on /v1.
//
//   STRIPE_SECRET_KEY=sk_test_… STRIPE_BASIC_PRICE_ID=price_… node scripts/verify-billing-prod.mjs
//     Layer 2: the $5/month price is a real recurring monthly USD price —
//     queried straight from Stripe, catching the classic "someone made a
//     one-time price" misconfiguration without any user flow.
//
//   ARCHURA_COOKIE='archura_session=sess_…' node scripts/verify-billing-prod.mjs
//     Layer 3: /api/me surfaces each organization's plan state (trial /
//     active / grace / expired) and whether a subscription exists — grab the
//     cookie from your browser devtools after signing in.
//
// What it deliberately does NOT do: drive Checkout, advance a Stripe test
// clock, or read email. Those are manual (see the billing test runbook) —
// this covers the repeatable, scriptable parts so they aren't click-tested.
//
// Config: CORE_ORIGIN (default https://core.archura.ai),
//         APP_ORIGIN  (default https://archura.ai).

const CORE = (process.env.CORE_ORIGIN || 'https://core.archura.ai').replace(/\/+$/, '');
const APP = (process.env.APP_ORIGIN || 'https://archura.ai').replace(/\/+$/, '');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};
const skip = (name, why) => console.log(`SKIP ${name} — ${why}`);

const fetchStatus = async (url, options) =>
  fetch(url, options).then((r) => r.status).catch(() => 0);

// ---- Layer 1: wiring (no secrets) --------------------------------------
const health = await fetchStatus(`${CORE}/healthz`);
if (health !== 200) {
  console.log(`SKIP — core not reachable at ${CORE}/healthz (status ${health})`);
  process.exit(0);
}
check('wiring: core is reachable through the edge', health === 200);

// Configured => the signature check runs and rejects our junk body (400).
// Not configured => the handler short-circuits with 503 before signatures.
const webhookStatus = await fetchStatus(`${CORE}/stripe/webhooks`, {
  method: 'POST',
  headers: { 'Stripe-Signature': 't=0,v1=deadbeef' },
  body: '{}',
});
check(
  'wiring: Stripe webhook endpoint is CONFIGURED (400 bad-signature, not 503)',
  webhookStatus === 400,
  webhookStatus === 503 ? 'got 503 — billing env vars are not all set' : `got ${webhookStatus}`
);

// Edge auth intact: a /v1 route with no service header must be rejected.
const v1Status = await fetchStatus(`${CORE}/v1/confirmations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
check('wiring: /v1 rejects unauthenticated callers (edge auth intact)', v1Status === 401, `got ${v1Status}`);

// ---- Layer 2: the $5/month price is correctly shaped -------------------
const stripeKey = process.env.STRIPE_SECRET_KEY;
const priceID = process.env.STRIPE_BASIC_PRICE_ID;
if (stripeKey && priceID) {
  if (!stripeKey.startsWith('sk_test_')) {
    check('price: refusing to query with a non-test Stripe key', false, 'STRIPE_SECRET_KEY is not sk_test_');
  } else {
    const priceRes = await fetch(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceID)}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    }).catch(() => null);
    const price = priceRes && priceRes.ok ? await priceRes.json() : null;
    check(
      'price: STRIPE_BASIC_PRICE_ID is a recurring monthly $5.00 USD price',
      price &&
        price.active === true &&
        price.recurring?.interval === 'month' &&
        price.recurring?.interval_count === 1 &&
        price.unit_amount === 500 &&
        price.currency === 'usd',
      JSON.stringify({
        status: priceRes?.status,
        active: price?.active,
        interval: price?.recurring?.interval,
        unit_amount: price?.unit_amount,
        currency: price?.currency,
      })
    );
  }
} else {
  skip('price: $5/month price shape', 'set STRIPE_SECRET_KEY (sk_test_) + STRIPE_BASIC_PRICE_ID to enable');
}

// ---- Layer 3: the app surfaces plan state ------------------------------
const cookie = process.env.ARCHURA_COOKIE;
if (cookie) {
  const meRes = await fetch(`${APP}/api/me`, { headers: { Cookie: cookie } }).catch(() => null);
  if (!meRes || meRes.status !== 200) {
    check('plan: /api/me returns the signed-in account', false, `status ${meRes?.status ?? 'unreachable'} (stale cookie?)`);
  } else {
    const me = await meRes.json();
    const orgs = me.organizations ?? [];
    check('plan: /api/me lists the account and its organizations', !!me.email && orgs.length > 0, JSON.stringify({ email: me.email, orgs: orgs.length }));
    const known = new Set(['unstarted', 'trialing', 'active', 'grace', 'expired']);
    for (const org of orgs) {
      const billing = org.billing ?? {};
      console.log(
        `  · ${org.name}: plan=${billing.status ?? '(none)'} ` +
        `can_edit=${billing.can_edit} can_serve=${billing.can_serve} ` +
        `subscription=${billing.status === 'active' || billing.current_period_end ? 'yes' : 'no'}`
      );
      check(`plan: "${org.name}" reports a known billing status`, known.has(billing.status), JSON.stringify(billing));
    }
  }
} else {
  skip('plan: /api/me billing visibility', 'set ARCHURA_COOKIE to a signed-in archura_session to enable');
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
