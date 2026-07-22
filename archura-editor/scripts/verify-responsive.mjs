// Verification for the responsive viewport: device tabs resize the canvas
// frame (like a browser's responsive mode), the preview width is adjustable,
// and edits made in a device write into that breakpoint's @media bucket.
// Usage: node scripts/verify-responsive.mjs (expects vite dev server on :5199)
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

const frameWidth = async () => Math.round((await page.locator('iframe.gjs-frame').boundingBox()).width);

try {
  await page.goto(`${BASE}/edit/?component=pages/Cards`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });

  // --- 1. Device tabs resize the canvas frame ---
  const desktopWidth = await frameWidth();
  check('responsive: Desktop frame fills the viewport', desktopWidth > 900, `${desktopWidth}px`);
  check('responsive: no width control on the base (Desktop) device', !(await page.locator('.width-input').isVisible()));

  await page.getByRole('button', { name: 'Mobile' }).click();
  await page.waitForTimeout(600);
  const mobileWidth = await frameWidth();
  check('responsive: Mobile tab shrinks the frame to ~375px', Math.abs(mobileWidth - 375) < 12, `${mobileWidth}px`);
  check(
    'responsive: width control appears showing the preview width',
    (await page.locator('.width-input').inputValue()) === '375'
  );

  // --- 2. Preview width is adjustable ---
  await page.locator('.width-input').fill('320');
  await page.locator('.width-input').press('Enter');
  await page.waitForTimeout(500);
  check('responsive: typing a width resizes the frame live', Math.abs((await frameWidth()) - 320) < 12, `${await frameWidth()}px`);

  // --- 3. Editing in mobile mode authors into the @media bucket, not the base ---
  await page.evaluate(() => {
    window.__artifacts = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => {
      window.__artifacts = e.detail.artifacts;
    });
  });
  await frame.locator('archura-card').first().click({ position: { x: 10, y: 10 } });
  const fontSize = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fontSize.waitFor({ state: 'visible', timeout: 10000 });
  await fontSize.fill('11');
  await fontSize.press('Enter');
  await page.waitForTimeout(300);

  await page.evaluate(() => document.getElementById('editor').getController().save());
  await page.waitForFunction(() => window.__artifacts !== null, null, { timeout: 10000 });
  const artifact = (await page.evaluate(() => window.__artifacts))[0];
  check(
    'responsive: mobile edit lands in @media (max-width: 767px), not the base rule',
    /@media[^{]*max-width:\s*767px[^{]*\{[^]*--font-size:\s*11px/.test(artifact.snapshot.css) &&
      !/^[^@]*--font-size:\s*11px/.test(artifact.snapshot.css.split('@media')[0]),
    artifact.snapshot.css.slice(0, 300)
  );

  // --- 4. Back to Desktop: frame fills again, control hidden ---
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(600);
  check('responsive: returning to Desktop refills the frame', (await frameWidth()) > 900, `${await frameWidth()}px`);
  check('responsive: width control hidden again on Desktop', !(await page.locator('.width-input').isVisible()));

  // --- 5. Deployed page honors the mobile breakpoint at narrow widths ---
  const deploy = await browser.newPage();
  await deploy.goto(`${BASE}/blank.html`, { waitUntil: 'domcontentloaded' });
  await deploy.evaluate(async ({ snapshot }) => {
    document.body.innerHTML = `<style>${snapshot.css}</style>${snapshot.html}`;
    await import('/src/components/heroes/Hero.js');
    await import('/src/components/cards/Card.js');
  }, artifact);
  await deploy.locator('archura-card').first().waitFor({ state: 'visible', timeout: 10000 });
  await deploy.setViewportSize({ width: 400, height: 800 });
  await deploy.waitForTimeout(300);
  const narrowFont = await deploy.locator('archura-card').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  await deploy.setViewportSize({ width: 1200, height: 800 });
  await deploy.waitForTimeout(300);
  const wideFont = await deploy.locator('archura-card').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  check(
    'responsive: deployed page applies the mobile rule only below the breakpoint',
    narrowFont === '11px' && wideFont !== '11px',
    `narrow=${narrowFont} wide=${wideFont}`
  );
  await deploy.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
