// Verification for EDITOR_PARITY.md §9 (drag-to-resize), §10 (inline text
// editing), §11 (part-level styling + Card contract fix).
// Usage: node scripts/verify-parity2.mjs (expects vite dev server on :5199)
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
  await page.goto(`${BASE}/edit/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => {
    window.__artifacts = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => {
      window.__artifacts = e.detail.artifacts;
    });
  });
  const firstCard = frame.locator('archura-card').first();

  // --- §11a. Card contract fix: internals no longer paint over the host ---
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.locator('.panel label', { hasText: 'Background' }).locator('input').fill('#00ff00');
  await page.getByRole('button', { name: 'Theme' }).click();
  await page
    .waitForFunction(
      () => {
        const card = document.querySelector('iframe')?.contentDocument?.querySelector('archura-card');
        return card ? getComputedStyle(card).backgroundColor === 'rgb(0, 255, 0)' : false;
      },
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  const cardPaint = await firstCard.evaluate((el) => ({
    host: getComputedStyle(el).backgroundColor,
    coveringDiv: !!el.shadowRoot?.querySelector('.card'),
  }));
  check(
    'card fix: theme background reaches the whole card (no covering .card paint)',
    cardPaint.host === 'rgb(0, 255, 0)' && !cardPaint.coveringDiv,
    JSON.stringify(cardPaint)
  );

  // --- §11b. Part drill-down: select card, then click the title ---
  await firstCard.click({ position: { x: 10, y: 10 } });
  check('part: single click selects host, no part chip yet', !(await page.locator('.part-chip').isVisible()));
  const devicesXBefore = (await page.getByRole('button', { name: 'Tablet' }).boundingBox()).x;
  await frame.locator('archura-card h3').first().click();
  await page.locator('.part-chip', { hasText: 'title' }).waitFor({ timeout: 5000 });
  check('part: second click on the title shows the part chip', true);
  const devicesXAfter = (await page.getByRole('button', { name: 'Tablet' }).boundingBox()).x;
  check(
    'part: chip does not shift the device switcher',
    Math.abs(devicesXBefore - devicesXAfter) < 2,
    `${devicesXBefore} → ${devicesXAfter}`
  );

  const sectorVisibility = async (name) =>
    page
      .locator('.gjs-sm-sector', { has: page.locator('.gjs-sm-sector-label', { hasText: name }) })
      .isVisible();
  check(
    'part: only the part sector is shown',
    (await sectorVisibility('Selected Part')) && !(await sectorVisibility('Decorations')),
    `part=${await sectorVisibility('Selected Part')} decorations=${await sectorVisibility('Decorations')}`
  );

  // Style the title alone
  const partColor = page
    .locator('.gjs-sm-sector', { has: page.locator('.gjs-sm-sector-label', { hasText: 'Selected Part' }) })
    .locator('.gjs-sm-property', { hasText: 'Color' })
    .locator('input')
    .first();
  await partColor.fill('#ff0000');
  await partColor.press('Enter');
  const titleStyles = await firstCard.evaluate((el) => ({
    title: getComputedStyle(el.shadowRoot.querySelector('h3')).color,
    content: getComputedStyle(el.shadowRoot.querySelector('p')).color,
  }));
  check(
    'part: title styled independently of content',
    titleStyles.title === 'rgb(255, 0, 0)' && titleStyles.content !== 'rgb(255, 0, 0)',
    JSON.stringify(titleStyles)
  );

  // Active part is visually outlined (editor-only, not in the artifact)
  const highlight = await frame.locator('archura-card h3').first().evaluate((el) => {
    const outline = getComputedStyle(el).outlineStyle;
    return { outline };
  });
  check('part: active part shows a dashed outline', highlight.outline === 'dashed', JSON.stringify(highlight));

  // Exit part mode restores host sectors and removes the outline
  await page.locator('.chip-close').click();
  const clearedOutline = await frame
    .locator('archura-card h3')
    .first()
    .evaluate((el) => getComputedStyle(el).outlineStyle);
  check(
    'part: closing the chip restores host sectors and clears the outline',
    !(await page.locator('.part-chip').isVisible()) &&
      (await sectorVisibility('Decorations')) &&
      clearedOutline !== 'dashed',
    `outline=${clearedOutline}`
  );

  // Editable text advertises itself: a canvas-only hint sheet gives editable
  // parts a text cursor + dashed outline on hover
  const hintCss = await frame
    .locator('style[data-archura-editor-hints]')
    .evaluate((el) => el.textContent)
    .catch(() => '');
  check(
    'inline text: editable parts get a hover hint (text cursor)',
    /archura-card::part\(title\):hover\s*\{[^}]*cursor:\s*text/.test(hintCss),
    hintCss.slice(0, 120)
  );

  // --- §10. Inline text editing on the card title ---
  await frame.locator('archura-card h3').first().dblclick();
  await page.keyboard.type('Edited By Hand');
  await frame.locator('archura-hero').click({ position: { x: 10, y: 10 } });
  let editedTitle = '';
  for (let i = 0; i < 25; i++) {
    editedTitle = (await frame.locator('archura-card').first().getAttribute('title')) ?? '';
    if (editedTitle === 'Edited By Hand') break;
    await page.waitForTimeout(200);
  }
  check('inline text: double-click edit commits to the component attribute', editedTitle === 'Edited By Hand', editedTitle);
  await firstCard.click({ position: { x: 10, y: 10 } });
  const traitValue = await page
    .locator('.gjs-trt-trait', { has: page.locator('.gjs-label', { hasText: /^Title$/ }) })
    .locator('input')
    .inputValue();
  check('inline text: traits panel reflects the inline edit', traitValue === 'Edited By Hand', traitValue);

  // --- §9. Drag-to-resize writes --width ---
  const handle = page.locator('.gjs-resizer-h-cr').first();
  await handle.waitFor({ state: 'visible', timeout: 5000 });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  let resized = '';
  for (let i = 0; i < 10; i++) {
    resized = await firstCard.evaluate((el) => getComputedStyle(el).getPropertyValue('--width').trim());
    if (/(px|%)$/.test(resized)) break;
    await page.waitForTimeout(200);
  }
  check('resize: dragging the right handle writes --width', /(px|%)$/.test(resized), `--width="${resized}"`);

  // --- Publish: everything lands in the artifact through existing channels ---
  await page.evaluate(() => document.getElementById('editor').getController().save());
  await page.waitForFunction(() => window.__artifacts !== null, null, { timeout: 10000 });
  const artifact = (await page.evaluate(() => window.__artifacts))[0];
  check(
    'artifact: ::part rule, edited title, and --width all captured',
    artifact.snapshot.css.includes('::part(title)') &&
      /title="Edited By Hand"/.test(artifact.snapshot.html) &&
      (artifact.snapshot.html.includes('--width') || artifact.snapshot.css.includes('--width')),
    `css: ${artifact.snapshot.css.slice(0, 200)}`
  );
  check(
    'artifact: editor-only affordances (outline/hint) do not leak',
    !/dashed/.test(artifact.snapshot.css) &&
      !artifact.snapshot.css.includes('archura-editor-hints') &&
      !artifact.snapshot.html.includes('data-archura'),
    `css: ${artifact.snapshot.css.slice(0, 200)}`
  );

  // --- Standalone deploy: part styling works outside the editor ---
  const deploy = await browser.newPage();
  await deploy.goto(`${BASE}/blank.html`, { waitUntil: 'domcontentloaded' });
  await deploy.evaluate(async ({ snapshot }) => {
    document.body.innerHTML = `<style>${snapshot.css}</style>${snapshot.html}`;
    await import('/src/components/cards/Card.js');
    await import('/src/components/heroes/Hero.js');
  }, artifact);
  await deploy.locator('archura-card').first().waitFor({ state: 'visible', timeout: 10000 });
  const deployed = await deploy.evaluate(() => {
    const card = document.querySelector('archura-card');
    return {
      titleColor: getComputedStyle(card.shadowRoot.querySelector('h3')).color,
      title: card.getAttribute('title'),
    };
  });
  check(
    'deploy: part color and edited title render standalone',
    deployed.titleColor === 'rgb(255, 0, 0)' && deployed.title === 'Edited By Hand',
    JSON.stringify(deployed)
  );
  await deploy.close();

  // --- §11c. Host scoping: Image hides typography sectors ---
  await page.goto(`${BASE}/edit/?component=media/Image`, { waitUntil: 'domcontentloaded' });
  await page.frameLocator('iframe.gjs-frame').locator('archura-image').waitFor({ state: 'visible', timeout: 20000 });
  await page.frameLocator('iframe.gjs-frame').locator('archura-image').click();
  let scoped = false;
  for (let i = 0; i < 15; i++) {
    scoped = (await sectorVisibility('Dimension')) && !(await sectorVisibility('Typography'));
    if (scoped) break;
    await page.waitForTimeout(200);
  }
  check(
    'host scoping: Image exposes Dimension but not Typography',
    scoped,
    `dim=${await sectorVisibility('Dimension')} typo=${await sectorVisibility('Typography')}`
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
