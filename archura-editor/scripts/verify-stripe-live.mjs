// LIVE verification for StripePayment: mounts real Stripe Elements with a real
// test publishable key (read from ../../.env, never committed). Answers the
// open question: do Stripe's iframes mount inside our shadow DOM?
// Skips cleanly when the key is absent. Usage: node scripts/verify-stripe-live.mjs
// (expects vite dev server on :5199)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
let pk = '';
try {
  const env = readFileSync(join(here, '..', '..', '.env'), 'utf8');
  pk = env.match(/^STRIPE_TEST_PUBLISHABLE_KEY=(\S+)/m)?.[1] ?? '';
} catch {
  /* no .env */
}
if (!/^pk_test_/.test(pk)) {
  console.log('SKIP — no STRIPE_TEST_PUBLISHABLE_KEY in .env');
  process.exit(0);
}

const BASE = 'http://localhost:5199';
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

try {
  await page.goto(`${BASE}/blank.html`, { waitUntil: 'domcontentloaded' });
  // Render the component standalone (no editor) with a real Stripe key + our
  // custom-property styling, exactly like a deployed/embedded page.
  await page.evaluate(async (pk) => {
    document.body.innerHTML =
      `<archura-stripe-payment stripe-publishable-key="${pk}" amount="2500" currency="usd"` +
      ` style="--color:#0f172a;--font-family:'Poppins',sans-serif;--font-size:17px;--button-background:#0f766e"></archura-stripe-payment>`;
    await import('/src/components/payments/StripePayment.js');
  }, pk);

  const el = page.locator('archura-stripe-payment');
  await el.waitFor({ state: 'visible', timeout: 10000 });

  // Stripe.js loads from js.stripe.com, then each Element mounts as an iframe.
  const loaded = await page
    .waitForFunction(() => !!document.querySelector('script[src^="https://js.stripe.com"]'), null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('live: Stripe.js loaded from js.stripe.com', loaded);

  // Stripe mounts each Element as an iframe into our light-DOM .mount nodes.
  const mounted = await el
    .evaluate(async (node) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const iframes = node.querySelectorAll('.control iframe');
        if (iframes.length >= 3) return iframes.length;
        await new Promise((r) => setTimeout(r, 200));
      }
      return node.querySelectorAll('.control iframe').length;
    })
    .catch(() => 0);
  check('live: 3 Stripe card Elements mount into the light-DOM form', mounted >= 3, `iframes=${mounted}`);

  const state = await el.evaluate((node) => ({
    badge: node.querySelector('.badge')?.textContent ?? '',
    hostLive: node.classList.contains('live'),
  }));
  check('live: component reports live mode (Secured by Stripe)', /Secured by Stripe/.test(state.badge), state.badge);
  check('live: host switched to live mode', state.hostLive);

  check('live: no console/page errors during mount', consoleErrors.length === 0, consoleErrors.join(' | '));

  await page.screenshot({ path: join(here, '_stripe-live.png') });
  console.log('screenshot: scripts/_stripe-live.png');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
