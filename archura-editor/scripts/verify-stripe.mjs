// Verification for the StripePayment Lit component (frontend, no backend).
// Covers: mock-mode render, our styling contract reaching the form, the
// custom-prop → Stripe element-style bridge, and editor integration.
// Usage: node scripts/verify-stripe.mjs (expects vite dev server on :5199)
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
rmSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts'), { recursive: true, force: true });

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

try {
  // --- 1. The style bridge is a correct pure function ---
  await page.goto(`${BASE}/edit/?component=payments/StripePayment`, { waitUntil: 'domcontentloaded' });
  const bridge = await page.evaluate(async () => {
    const { stripeElementStyle } = await import('/src/components/payments/StripePayment.js');
    const fakeCS = {
      map: {
        '--color': '#123456',
        '--font-family': "'Poppins', sans-serif",
        '--font-size': '18px',
        '--error-color': '#ff0000',
      },
      getPropertyValue(name) {
        return this.map[name] ?? '';
      },
    };
    return stripeElementStyle(fakeCS);
  });
  check(
    'bridge: custom props map into Stripe element style',
    bridge.base.color === '#123456' &&
      bridge.base.fontFamily === "'Poppins', sans-serif" &&
      bridge.base.fontSize === '18px' &&
      bridge.invalid.color === '#ff0000',
    JSON.stringify(bridge)
  );
  check(
    'bridge: falls back to defaults for unset props',
    (await page.evaluate(async () => {
      const { stripeElementStyle } = await import('/src/components/payments/StripePayment.js');
      const cs = { getPropertyValue: () => '' };
      return stripeElementStyle(cs).base.color;
    })) === '#111827'
  );

  // --- 2. Mock-mode render in the editor canvas ---
  const frame = page.frameLocator('iframe.gjs-frame');
  const pay = frame.locator('archura-stripe-payment');
  await pay.waitFor({ state: 'visible', timeout: 20000 });
  const rendered = await pay.evaluate((el) => {
    const r = el; // light DOM
    return {
      fields: r.querySelectorAll('.control').length,
      placeholders: r.querySelectorAll('.placeholder').length,
      hostLive: el.classList.contains('live'),
      button: r.querySelector('button.pay')?.textContent?.trim(),
      badge: r.querySelector('.badge')?.textContent ?? '',
    };
  });
  check(
    'render: three placeholder card fields shown in mock mode',
    rendered.fields === 3 && rendered.placeholders === 3 && !rendered.hostLive
  );
  check('render: pay button shows label + formatted price', /Pay\s+\$10\.00/.test(rendered.button), rendered.button);
  check('render: preview badge indicates no real key yet', /Preview/.test(rendered.badge), rendered.badge);

  // --- 3. No Stripe.js loaded in mock mode (no real key) ---
  const stripeLoaded = await page.evaluate(
    () => !!document.querySelector('script[src^="https://js.stripe.com"]')
  );
  check('mock: Stripe.js is NOT loaded without a real key', !stripeLoaded);

  // --- 4. Our styling contract reaches the form; part-level host styling works ---
  await pay.click({ position: { x: 10, y: 10 } });
  const fontSizeInput = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fontSizeInput.waitFor({ state: 'visible', timeout: 10000 });
  await fontSizeInput.fill('22');
  await fontSizeInput.press('Enter');
  await page.waitForTimeout(300);
  const styled = await pay.evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  check('styling: custom-prop contract applies to the component', styled === '22px', styled);

  // Typography Color must cascade to the text (labels), not be swallowed by
  // per-element color overrides.
  const colorInput = page
    .locator('.gjs-sm-sector', { has: page.locator('.gjs-sm-sector-label', { hasText: 'Typography' }) })
    .locator('.gjs-sm-property', { hasText: 'Color' })
    .locator('input')
    .first();
  await colorInput.fill('#ff0000');
  await colorInput.press('Enter');
  await page.waitForTimeout(300);
  const labelColor = await pay.evaluate((el) => getComputedStyle(el.querySelector('label')).color);
  check('styling: Typography Color changes the label text', labelColor === 'rgb(255, 0, 0)', labelColor);

  // --- 4b. Light-DOM part styling: recolor only the Card number label ---
  // (component already selected; second click on the label drills into its part)
  await frame.locator('archura-stripe-payment label[data-part="cardLabel"]').click();
  await page.locator('.part-chip', { hasText: 'cardLabel' }).waitFor({ timeout: 5000 });
  check('part: clicking the Card number label drills into its part', true);
  const partColor = page
    .locator('.gjs-sm-sector', { has: page.locator('.gjs-sm-sector-label', { hasText: 'Selected Part' }) })
    .locator('.gjs-sm-property', { hasText: 'Color' })
    .locator('input')
    .first();
  await partColor.fill('#0000ff');
  await partColor.press('Enter');
  await page.waitForTimeout(300);
  const partColors = await pay.evaluate((el) => ({
    card: getComputedStyle(el.querySelector('[data-part="cardLabel"]')).color,
    expiry: getComputedStyle(el.querySelector('[data-part="expiryLabel"]')).color,
  }));
  check(
    'part: only the Card number label recolors (expiry stays)',
    partColors.card === 'rgb(0, 0, 255)' && partColors.expiry !== 'rgb(0, 0, 255)',
    JSON.stringify(partColors)
  );
  await page.locator('.chip-close').click();

  // --- 5. Editor breadcrumb + registry integration ---
  check(
    'editor: Stripe Payment is a registered, editable target',
    /Components\s*\/\s*Stripe Payment/.test(await page.locator('.breadcrumb').innerText())
  );

  // --- 6. Publish → the component survives into a deployable artifact ---
  await page.evaluate(() => {
    window.__a = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => (window.__a = e.detail.artifacts));
  });
  await page.getByRole('button', { name: /Publish|Save/ }).click();
  await page.waitForFunction(() => window.__a !== null, null, { timeout: 10000 });
  const artifact = (await page.evaluate(() => window.__a))[0];
  check(
    'publish: artifact contains the stripe-payment element',
    /<archura-stripe-payment/.test(artifact.snapshot.html),
    artifact.snapshot.html.slice(0, 160)
  );
  check(
    'publish: light-DOM form markup does NOT leak into the artifact',
    !/data-mount|class="form"|class="placeholder"/.test(artifact.snapshot.html),
    artifact.snapshot.html.slice(0, 240)
  );
  check(
    'publish: light-DOM part rule (data-part) captured in the artifact css',
    /\[data-part="cardLabel"\]\s*\{[^}]*color/.test(artifact.snapshot.css),
    artifact.snapshot.css.match(/\[data-part[^}]*\}/)?.[0] ?? '(none)'
  );

  // --- 7. Standalone deploy: renders in mock mode with no editor, no key ---
  const deploy = await browser.newPage();
  const deployErrors = [];
  deploy.on('console', (m) => m.type() === 'error' && deployErrors.push(m.text()));
  await deploy.goto(`${BASE}/blank.html`, { waitUntil: 'domcontentloaded' });
  await deploy.evaluate(async ({ snapshot }) => {
    document.body.innerHTML = `<style>${snapshot.css}</style>${snapshot.html}`;
    await import('/src/components/payments/StripePayment.js');
  }, artifact);
  await deploy.locator('archura-stripe-payment').waitFor({ state: 'visible', timeout: 10000 });
  const deployed = await deploy.locator('archura-stripe-payment').evaluate((el) => ({
    fields: el.querySelectorAll('.control').length,
    stripeLoaded: !!document.querySelector('script[src^="https://js.stripe.com"]'),
    cardLabel: getComputedStyle(el.querySelector('[data-part="cardLabel"]')).color,
    expiryLabel: getComputedStyle(el.querySelector('[data-part="expiryLabel"]')).color,
  }));
  check(
    'deploy: renders standalone in mock mode, no Stripe.js, no console errors',
    deployed.fields === 3 && !deployed.stripeLoaded && deployErrors.length === 0,
    JSON.stringify({ fields: deployed.fields, stripeLoaded: deployed.stripeLoaded, deployErrors })
  );
  check(
    'deploy: light-DOM part color applies standalone (only Card number)',
    deployed.cardLabel === 'rgb(0, 0, 255)' && deployed.expiryLabel !== 'rgb(0, 0, 255)',
    JSON.stringify({ card: deployed.cardLabel, expiry: deployed.expiryLabel })
  );
  await deploy.close();

  // --- 8. Search params configure a component's declared props (Base, ALL
  // components) — including the common client-key, and no defaulted keys ---
  const demoP = await browser.newPage();
  await demoP.goto(
    `${BASE}/demo/?component=payments/StripePayment&amount=5000&button-label=Donate&client-key=pk_test_abc`,
    { waitUntil: 'domcontentloaded' }
  );
  const sp = demoP.locator('archura-stripe-payment');
  await sp.waitFor({ state: 'visible', timeout: 10000 });
  // If the demo defaulted a test key, live mode injects Stripe.js asynchronously.
  await demoP.waitForTimeout(800);
  const spState = await sp.evaluate((el) => ({
    button: el.querySelector('button.pay')?.textContent?.trim(),
    clientKey: el.clientKey,
    stripeKey: el.getAttribute('stripe-publishable-key') || '',
    stripeLoaded: !!document.querySelector('script[src^="https://js.stripe.com"]'),
  }));
  check(
    'params: search params set component props (amount, button-label, common client-key)',
    /Donate\s+\$50\.00/.test(spState.button) && spState.clientKey === 'pk_test_abc',
    JSON.stringify({ button: spState.button, clientKey: spState.clientKey })
  );
  // The demo may default a Stripe key so the form is real, but it must ALWAYS be
  // a test key — never live. (The component itself never self-defaults; that
  // guarantee is covered by the standalone deploy test in §7.)
  check(
    'demo: any defaulted Stripe key is a test key (never live)',
    !spState.stripeKey || /^pk_test_/.test(spState.stripeKey),
    spState.stripeKey
  );
  check(
    'demo: Stripe form state matches the key (key ⇒ live form, none ⇒ mock)',
    spState.stripeKey ? spState.stripeLoaded : !spState.stripeLoaded,
    JSON.stringify({ hasKey: !!spState.stripeKey, stripeLoaded: spState.stripeLoaded })
  );

  // Any component (shadow DOM too) reads params via Base.
  await demoP.goto(`${BASE}/demo/?component=cards/Card&title=FromURL`, { waitUntil: 'domcontentloaded' });
  const card = demoP.locator('archura-card');
  await card.waitFor({ state: 'visible', timeout: 10000 });
  const cardTitle = await card.evaluate((el) => el.shadowRoot.querySelector('h3')?.textContent);
  check('params: search params configure any component (Card title from URL)', cardTitle === 'FromURL', cardTitle);
  await demoP.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
