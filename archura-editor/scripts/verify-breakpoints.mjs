// Verification for editable breakpoints (desktop-first, max-width): changing a
// breakpoint's threshold moves all its rules at once (migration), new edits
// author into the new bucket, validation rejects overlaps, and the custom
// thresholds round-trip through publish/reload and deploy.
// Usage: node scripts/verify-breakpoints.mjs (expects vite dev server on :5199)
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));

const publish = async () => {
  await page.evaluate(() => (window.__a = null));
  await page.getByRole('button', { name: /Publish|Save/ }).click();
  await page.waitForFunction(() => window.__a !== null, null, { timeout: 10000 });
  return (await page.evaluate(() => window.__a))[0];
};
const setMobileFont = async (v) => {
  const fs = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fs.waitFor({ state: 'visible', timeout: 10000 });
  await fs.fill(String(v));
  await fs.press('Enter');
  await page.waitForTimeout(300);
};
const openBreakpoints = async () => {
  if (!(await page.locator('.panel .width-input').first().isVisible().catch(() => false))) {
    await page.locator('button', { hasText: 'Breakpoints' }).click();
    await page.waitForTimeout(200);
  }
};

try {
  await page.goto(`${BASE}/edit/?component=pages/Cards`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => {
    window.__a = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => (window.__a = e.detail.artifacts));
  });

  // --- 1. Panel lists the two default breakpoints ---
  await openBreakpoints();
  const bpInputs = page.locator('.panel .width-input');
  check(
    'breakpoints: panel lists Tablet 991 and Mobile 767',
    JSON.stringify(await bpInputs.evaluateAll((els) => els.map((e) => e.value))) === '["991","767"]'
  );

  // --- 2. Author a style in the Mobile (767) bucket ---
  await page.getByRole('button', { name: 'Mobile' }).click();
  await page.waitForTimeout(400);
  await frame.locator('archura-card').first().click({ position: { x: 10, y: 10 } });
  await setMobileFont(22);
  let art = await publish();
  check(
    'breakpoints: mobile edit authored into @media (max-width: 767px)',
    /@media[^{]*max-width:\s*767px[^{]*\{[^]*--font-size:\s*22px/.test(art.snapshot.css)
  );

  // --- 3. Change the Mobile breakpoint 767 -> 600: rules migrate ---
  await openBreakpoints();
  await bpInputs.nth(1).fill('600');
  await bpInputs.nth(1).press('Enter');
  await page.waitForTimeout(500);
  art = await publish();
  check(
    'breakpoints: changing the threshold moves all its rules to the new width',
    /@media[^{]*max-width:\s*600px[^{]*\{[^]*--font-size:\s*22px/.test(art.snapshot.css) &&
      !/max-width:\s*767px/.test(art.snapshot.css),
    art.snapshot.css.match(/@media[^{]*\{/g)?.join(' ')
  );

  // --- 4. New edits now author into the new (600) bucket ---
  await frame.locator('archura-card').first().click({ position: { x: 10, y: 10 } });
  await setMobileFont(14);
  art = await publish();
  check(
    'breakpoints: subsequent mobile edits land in the new bucket',
    /@media[^{]*max-width:\s*600px[^{]*\{[^]*--font-size:\s*14px/.test(art.snapshot.css)
  );

  // --- 5. Validation: a threshold within 40px of Tablet (991) is rejected ---
  await openBreakpoints();
  await bpInputs.nth(1).fill('970');
  await bpInputs.nth(1).press('Enter');
  await page.waitForTimeout(300);
  const rejected = (await page.locator('.panel .width-input').nth(1).inputValue()) === '600';
  check('breakpoints: overlapping threshold is rejected (stays 600)', rejected, await page.locator('.panel .width-input').nth(1).inputValue());

  // --- 6. Custom thresholds round-trip through reload ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => {
    window.__a = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => (window.__a = e.detail.artifacts));
  });
  await openBreakpoints();
  check(
    'breakpoints: custom threshold persists across reload',
    (await page.locator('.panel .width-input').nth(1).inputValue()) === '600'
  );

  // --- 7. Deployed page applies the mobile rule only below the new threshold ---
  const deploy = await browser.newPage();
  await deploy.goto(`${BASE}/blank.html`, { waitUntil: 'domcontentloaded' });
  await deploy.evaluate(async ({ snapshot }) => {
    document.body.innerHTML = `<style>${snapshot.css}</style>${snapshot.html}`;
    await import('/src/components/heroes/Hero.js');
    await import('/src/components/cards/Card.js');
  }, art);
  await deploy.locator('archura-card').first().waitFor({ state: 'visible', timeout: 10000 });
  await deploy.setViewportSize({ width: 550, height: 800 });
  await deploy.waitForTimeout(300);
  const at550 = await deploy.locator('archura-card').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  await deploy.setViewportSize({ width: 680, height: 800 });
  await deploy.waitForTimeout(300);
  const at680 = await deploy.locator('archura-card').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  check(
    'breakpoints: deployed page honors the moved breakpoint (≤600 applies, 680 does not)',
    at550 === '14px' && at680 !== '14px',
    `at550=${at550} at680=${at680}`
  );
  await deploy.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
