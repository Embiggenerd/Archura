// Verification for GAPS_AND_SOLUTIONS §5: persistence adapters + publish flow.
// Usage: node scripts/verify-section5.mjs (expects vite dev server on :5199)
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(pkgRoot, 'artifacts'), { recursive: true, force: true });
rmSync(join(pkgRoot, '.mock-r2'), { recursive: true, force: true });

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

try {
  // --- 1. Publish through the filesystem adapter ---
  await page.goto(`${BASE}/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 15000 });

  await frame.locator('archura-card').first().click();
  const fontSize = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fontSize.waitFor({ state: 'visible', timeout: 10000 });
  await fontSize.fill('24');
  await fontSize.press('Enter');

  const publishButton = page.getByRole('button', { name: /Publish/ });
  await publishButton.click();
  await page.getByRole('button', { name: 'Published' }).waitFor({ timeout: 10000 });
  check('publish: button reaches Published state', true);

  const stored = await page.evaluate(async () => {
    const res = await fetch('/api/artifacts/pages/Landing');
    return res.ok ? res.json() : null;
  });
  check(
    'publish: artifact written to the filesystem store',
    stored &&
      /--font-size:\s*24px/.test(stored.snapshot.html) &&
      stored.content?.components?.length === 3,
    JSON.stringify(stored?.config)
  );

  // --- 2. Load-on-open: reload boots from the published artifact ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 15000 });
  const reloadedStyles = await frame.locator('archura-card').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).getPropertyValue('--font-size').trim())
  );
  check(
    'load-on-open: editor restores the published state after reload',
    reloadedStyles[0] === '24px' && reloadedStyles[1] !== '24px',
    JSON.stringify(reloadedStyles)
  );

  // --- 3. Demo preview reads the store ---
  const demo = await browser.newPage();
  await demo.goto(`${BASE}/demo/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });
  await demo.locator('#root archura-hero').waitFor({ state: 'visible', timeout: 10000 });
  const demoProp = await demo
    .locator('#root archura-card')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  check('demo preview: renders the published artifact from the store', demoProp === '24px', demoProp);
  await demo.close();

  // --- 4. Toolbar state cycle with a slow adapter ---
  await page.evaluate(async () => {
    await import('/src/index.ts');
    const editor = document.createElement('archura-editor');
    editor.id = 'slow-editor';
    editor.style.cssText = 'height:700px;flex:none;display:block;';
    editor.componentPath = ['cards', 'Card'];
    editor.persistence = {
      load: async () => null,
      publish: () => new Promise((resolve) => setTimeout(resolve, 800)),
    };
    document.body.appendChild(editor);
  });
  const slowFrame = page.frameLocator('#slow-editor iframe.gjs-frame');
  await slowFrame.locator('archura-card').waitFor({ state: 'visible', timeout: 15000 });
  const slowButton = page.locator('#slow-editor').getByRole('button', { name: /Publish/ });
  await slowButton.click();
  await page.locator('#slow-editor').getByRole('button', { name: 'Publishing...' }).waitFor({ timeout: 2000 });
  check('publish: button shows Publishing... while the adapter promise is pending', true);
  await page.locator('#slow-editor').getByRole('button', { name: 'Published' }).waitFor({ timeout: 3000 });
  await page.locator('#slow-editor').getByRole('button', { name: 'Publish', exact: true }).waitFor({ timeout: 4000 });
  check('publish: button settles back to Publish after success', true);

  // --- 5. Failing adapter: error surfaces, editor survives ---
  const failure = await page.evaluate(async () => {
    const editor = document.createElement('archura-editor');
    editor.id = 'failing-editor';
    editor.style.cssText = 'height:700px;flex:none;display:block;';
    editor.componentPath = ['cards', 'Card'];
    editor.persistence = {
      load: async () => null,
      publish: async () => {
        throw new Error('deploy pipeline exploded');
      },
    };
    const errors = [];
    editor.addEventListener('editorerror', (e) => errors.push(String(e.detail.error)));
    document.body.appendChild(editor);
    window.__failErrors = errors;
  });
  const failFrame = page.frameLocator('#failing-editor iframe.gjs-frame');
  await failFrame.locator('archura-card').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#failing-editor').getByRole('button', { name: /Publish/ }).click();
  await page.locator('#failing-editor').getByRole('button', { name: 'Publish failed' }).waitFor({ timeout: 5000 });
  const failErrors = await page.evaluate(() => window.__failErrors);
  check(
    'publish failure: editorerror fired and button shows the failure',
    failErrors.length === 1 && failErrors[0].includes('deploy pipeline exploded'),
    JSON.stringify(failErrors)
  );
  await page.locator('#failing-editor').getByRole('button', { name: 'Publish', exact: true }).waitFor({ timeout: 4000 });
  const stillEditable = await failFrame.locator('archura-card').isVisible();
  check('publish failure: editor stays usable afterwards', stillEditable);

  // --- 6. R2 adapter against the mock Worker endpoint ---
  const r2 = await page.evaluate(async () => {
    const { createR2Adapter } = await import('/src/adapters/index.ts');
    const artifact = {
      schemaVersion: 1,
      id: 'r2-test',
      type: 'component-instance',
      content: {},
      snapshot: { html: '<archura-card title="R2"></archura-card>', css: '' },
      config: { componentPath: ['cards', 'Card'] },
      meta: { createdAt: '2026-07-09T00:00:00Z', updatedAt: '2026-07-09T00:00:00Z' },
    };

    const good = createR2Adapter({ endpoint: '/mock-r2', token: 'dev-token' });
    await good.publish(artifact);
    const loaded = await good.load({ kind: 'component', path: ['cards', 'Card'], label: 'Card' });

    const bad = createR2Adapter({ endpoint: '/mock-r2', token: 'wrong-token' });
    let authError = null;
    try {
      await bad.publish(artifact);
    } catch (e) {
      authError = String(e);
    }
    return { loadedId: loaded?.id, authError };
  });
  check('r2 adapter: publish/load round trip through the worker contract', r2.loadedId === 'r2-test', JSON.stringify(r2));
  check('r2 adapter: bad token is rejected with 401', r2.authError?.includes('401'), r2.authError ?? 'no error');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
