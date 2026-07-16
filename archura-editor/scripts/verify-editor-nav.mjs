// Verification for the target-switcher dropdown and the Cards page
// (edge-strip resize with pinned flex widths).
// Usage: node scripts/verify-editor-nav.mjs (expects vite dev server on :5199)
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
  // --- 1. Target switcher: breadcrumb opens a dropdown of registry targets ---
  await page.goto(`${BASE}/edit/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });

  // --- 0. Layout: sidebar is an independent, full-height scrolling column ---
  await frame.locator('archura-card').first().click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => {
    const shell = document
      .querySelector('archura-editor')
      .shadowRoot.querySelector('archura-editor-shell').shadowRoot;
    const sidebar = shell.querySelector('.sidebar');
    const canvas = shell.querySelector('.canvas');
    return {
      viewport: innerHeight,
      sidebarHeight: sidebar.clientHeight,
      canvasHeight: canvas.clientHeight,
      sidebarScrolls: sidebar.scrollHeight > sidebar.clientHeight,
      pageScrolls: document.documentElement.scrollHeight > innerHeight + 2,
    };
  });
  check(
    'layout: sidebar fills the editor height and scrolls independently',
    layout.sidebarHeight > layout.viewport * 0.7 &&
      Math.abs(layout.sidebarHeight - layout.canvasHeight) < 8 &&
      layout.sidebarScrolls &&
      !layout.pageScrolls,
    JSON.stringify(layout)
  );

  await page.locator('.crumb').click();
  const panel = page.locator('.panel.targets');
  await panel.waitFor({ timeout: 5000 });
  const labels = await panel.locator('.target').allInnerTexts();
  check(
    'switcher: dropdown lists pages and components from the registry',
    ['Landing', 'Cards', 'Card', 'Hero', 'Image'].every((l) => labels.some((t) => t.trim() === l)),
    labels.join(',')
  );
  check(
    'switcher: current target is highlighted',
    (await panel.locator('.target.current').innerText()).trim() === 'Landing'
  );

  // --- 2. Switching targets swaps the editor and updates the URL ---
  await panel.locator('.target', { hasText: 'Cards' }).click();
  await frame.locator('archura-card').nth(2).waitFor({ state: 'visible', timeout: 20000 });
  check('switcher: Cards page renders after switching (3 cards)', (await frame.locator('archura-card').count()) === 3);
  check(
    'switcher: breadcrumb and URL follow the new target',
    /Pages\s*\/\s*Cards/.test(await page.locator('.breadcrumb').innerText()) &&
      page.url().includes('component=pages%2FCards'),
    page.url()
  );

  // --- 3. Edge-strip resize: full-height handle, exact widths via pinned flex ---
  const firstCard = frame.locator('archura-card').first();
  await firstCard.click({ position: { x: 10, y: 10 } });
  const handle = page.locator('.gjs-resizer-h-cr').first();
  await handle.waitFor({ state: 'visible', timeout: 5000 });
  const handleBox = await handle.boundingBox();
  const cardBox = await firstCard.boundingBox();
  check(
    'resize: the width handle is a full-height edge strip (minus corner zones)',
    handleBox.height > cardBox.height * 0.7,
    `handle ${handleBox.height}px vs card ${cardBox.height}px`
  );

  // Drag outward: shrinking would hit Card's declared min-width clamp (240)
  const widthBefore = (await firstCard.boundingBox()).width;
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 80, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const widthAfter = (await firstCard.boundingBox()).width;
  const delta = widthAfter - widthBefore;
  check(
    'resize: dragged width is honored exactly (flex pinned)',
    delta > 60 && delta < 100,
    `width ${widthBefore} → ${widthAfter} (delta ${delta.toFixed(1)}, expected ~80)`
  );
  const varWidth = await firstCard.evaluate((el) => getComputedStyle(el).getPropertyValue('--width').trim());
  check('resize: drag wrote --width through the standard channel', /%$|px$/.test(varWidth), `--width="${varWidth}"`);

  // --- 3b. Completely resizable: all edges + corners, height via --min-height ---
  const handleCount = await page.locator('.gjs-resizer-h').evaluateAll(
    (els) => els.filter((el) => getComputedStyle(el).display !== 'none').length
  );
  check('resize: all edges and corners offer handles (8)', handleCount === 8, `${handleCount} handles`);

  const heightBefore = (await firstCard.boundingBox()).height;
  const bottomHandle = page.locator('.gjs-resizer-h-bc').first();
  const bottomBox = await bottomHandle.boundingBox();
  check(
    'resize: bottom handle is a full-width edge strip',
    bottomBox.width > (await firstCard.boundingBox()).width * 0.9,
    `strip ${bottomBox.width}px`
  );
  await page.mouse.move(bottomBox.x + bottomBox.width / 2, bottomBox.y + bottomBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bottomBox.x + bottomBox.width / 2, bottomBox.y + 70, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const heightAfter = (await firstCard.boundingBox()).height;
  const minHeight = await firstCard.evaluate((el) => getComputedStyle(el).getPropertyValue('--min-height').trim());
  check(
    'resize: bottom-edge drag grows the card via --min-height (no clipping possible)',
    heightAfter - heightBefore > 50 && /px$/.test(minHeight),
    `height ${heightBefore} → ${heightAfter}, --min-height="${minHeight}"`
  );

  // --- 4. Publish → deploy: resized layout survives standalone ---
  await page.evaluate(() => {
    window.__artifacts = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => {
      window.__artifacts = e.detail.artifacts;
    });
  });
  await page.getByRole('button', { name: /Publish|Save/ }).click();
  await page.waitForFunction(() => window.__artifacts !== null, null, { timeout: 10000 });
  const artifact = (await page.evaluate(() => window.__artifacts))[0];
  check(
    'artifact: Cards page identity, flex pin, and width all captured',
    artifact.config.componentPath.join('/') === 'pages/Cards' &&
      /flex:\s*0\s*0\s*auto/.test(artifact.snapshot.css + artifact.snapshot.html) &&
      (artifact.snapshot.html.includes('--width') || artifact.snapshot.css.includes('--width')),
    JSON.stringify(artifact.config)
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
