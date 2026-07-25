// Step 7: verify REAL compiler output against the unchanged Archura editor.
// Assumes build-real.mjs has run. Serves the harness, opens the generated
// page as a fresh editing target, edits a trait / a host style / a part
// style / a mobile override, saves, reloads, publishes, and checks that no
// file under archura-editor/src changed.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HARNESS_PORT || 5611);
const MARKER = `Real ${Date.now().toString(36)}`;

const registry = JSON.parse(readFileSync(join(here, 'out-real', 'registry.json'), 'utf8'));
const pageDef = registry.find((d) => d.kind === 'page');
const cardDef = registry.find((d) => d.kind === 'component');
const CARD = cardDef.tagName;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
};

// --- Static assertions before the browser opens ---

check(
  'registry: definitions carry moduleUrl, never modulePath',
  registry.every((d) => d.moduleUrl && !('modulePath' in d))
);
check(
  'registry: page uses lists exactly the card definition',
  JSON.stringify(pageDef.uses) === JSON.stringify([cardDef.path])
);
const generatedBundles = readdirSync(join(here, 'out-real')).filter((f) => f.startsWith('archura-') && f.endsWith('.js'));
const bundledSource = generatedBundles.map((f) => readFileSync(join(here, 'out-real', f), 'utf8')).join('\n');
check(
  'dependencies: no React or Plasmic runtime in generated bundles',
  !/require\(["']react["']\)|from\s*["']react["']|@plasmicapp/.test(bundledSource),
  `${generatedBundles.length} bundles scanned`
);

const server = await startServer(PORT);
const browser = await chromium.launch({ headless: !process.env.HEADED });
const page = await browser.newPage({ viewport: { width: 1760, height: 960 } });
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

const frameEl = () => page.frameLocator('iframe.gjs-frame');

async function canvasEval(fn, arg) {
  const handle = await page.locator('iframe.gjs-frame').elementHandle();
  const frame = await handle.contentFrame();
  return frame.evaluate(fn, arg);
}

async function waitForCanvas() {
  await frameEl().locator(CARD).first().waitFor({ state: 'visible', timeout: 30000 });
}

try {
  await page.goto(`http://localhost:${PORT}/host-real.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__harness);
  await page.evaluate(() => window.__harness.reset());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForCanvas();

  check('load: generated page opens without module errors', pageErrors.length === 0, pageErrors.join('; '));
  const cardCount = await frameEl().locator(CARD).count();
  check('load: three generated pricing cards render', cardCount === 3, `count=${cardCount}`);

  // --- Base layout (Flex/Grid/free-positioned) computed styles ---
  const layout = await canvasEval((tag) => {
    const card = document.querySelector(tag);
    const grid = card?.closest('div');
    const hero = document.querySelector('section');
    const free = [...document.querySelectorAll('div')].find(
      (el) => getComputedStyle(el).position === 'absolute'
    );
    const title = card?.shadowRoot?.querySelector('[part="title"]');
    const label = card?.shadowRoot?.querySelector('[data-edit="pricelabel"]');
    return {
      gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      heroDisplay: hero ? getComputedStyle(hero).display : 'missing',
      heroFlexDirection: hero ? getComputedStyle(hero).flexDirection : 'missing',
      freePosition: free ? 'absolute' : 'missing',
      cardPadding: card ? getComputedStyle(card).paddingTop : 'missing',
      titleColor: title ? getComputedStyle(title).color : 'missing',
      featured: document.querySelectorAll(`${tag}[featured]`).length,
      labelText: label?.textContent?.trim() ?? 'missing',
      slotted: card?.querySelector('[slot="features"]')?.textContent?.trim() ?? 'missing',
    };
  }, CARD);
  check('layout: grid renders 3 columns at desktop', layout.gridColumns === 3, `columns=${layout.gridColumns}`);
  check(
    'layout: hero is a flex column',
    layout.heroDisplay === 'flex' && layout.heroFlexDirection === 'column',
    `${layout.heroDisplay}/${layout.heroFlexDirection}`
  );
  check('layout: free-positioned element is absolute', layout.freePosition === 'absolute');
  check('defaults: host var() fallback paints padding 24px', layout.cardPadding === '24px', layout.cardPadding);
  check('variant: featured card reflects its attribute', layout.featured === 1, `count=${layout.featured}`);
  check(
    'variant: featured title takes the variant color',
    layout.titleColor !== 'missing',
    layout.titleColor
  );
  check('props: camelCase prop renders via canonical lowercase default', layout.labelText === 'per month', layout.labelText);
  check('slots: features slot content is assigned', layout.slotted.includes('feature'), layout.slotted);

  // --- Structure lock ---
  await frameEl().locator('section').first().click({ position: { x: 8, y: 8 }, force: true });
  const heroSelected = await canvasEval(() =>
    document.querySelector('section')?.classList.contains('gjs-selected')
  );
  check('lock: hero wrapper is not selectable', heroSelected === false, String(heroSelected));

  const firstCard = frameEl().locator(CARD).first();
  await firstCard.click({ position: { x: 10, y: 10 } });
  const cardSelected = await canvasEval(
    (tag) => document.querySelector(tag)?.classList.contains('gjs-selected'),
    CARD
  );
  check('select: generated card host is selectable', cardSelected === true, String(cardSelected));

  // --- Trait edit on the multi-word pricelabel prop (inline editing) ---
  await frameEl().locator(`${CARD} [data-edit="pricelabel"]`).first().dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(MARKER);
  await frameEl().locator('section').first().click({ position: { x: 8, y: 8 }, force: true });
  let labelAttr = '';
  for (let i = 0; i < 25; i++) {
    labelAttr = (await firstCard.getAttribute('pricelabel')) ?? '';
    if (labelAttr === MARKER) break;
    await page.waitForTimeout(200);
  }
  check('trait: pricelabel inline edit commits to the lowercase attribute', labelAttr === MARKER, labelAttr);

  // --- Host style through the StyleManager (contract var chain) ---
  await firstCard.click({ position: { x: 10, y: 10 } });
  const bgInput = page
    .locator('.gjs-sm-property', { hasText: 'Background' })
    .locator('input[type="text"], input:not([type])')
    .first();
  await bgInput.waitFor({ timeout: 5000 });
  await bgInput.fill('#00ff00');
  await bgInput.press('Enter');
  await page.waitForTimeout(300);
  const hostStyles = await canvasEval((tag) => {
    const card = document.querySelector(tag);
    const title = card.shadowRoot.querySelector('[part="title"]');
    return {
      background: getComputedStyle(card).backgroundColor,
      titleColor: getComputedStyle(title).color,
    };
  }, CARD);
  check(
    'host: --background-color override beats the generated var() fallback',
    hostStyles.background === 'rgb(0, 255, 0)',
    hostStyles.background
  );
  check(
    'host: host edit does not leak into the explicitly-colored title part',
    hostStyles.titleColor === 'rgb(15, 23, 42)',
    hostStyles.titleColor
  );

  // --- Part style through Selected Part (::part overrides plain shadow CSS) ---
  await frameEl().locator(`${CARD} [part="title"]`).first().click();
  await page.locator('.part-chip', { hasText: 'title' }).waitFor({ timeout: 5000 });
  const partColor = page
    .locator('.gjs-sm-sector', { has: page.locator('.gjs-sm-sector-label', { hasText: 'Selected Part' }) })
    .locator('.gjs-sm-property', { hasText: 'Color' })
    .locator('input')
    .first();
  await partColor.fill('#ff0000');
  await partColor.press('Enter');
  await page.waitForTimeout(300);
  const partStyles = await canvasEval((tag) => {
    const card = document.querySelector(tag);
    const title = card.shadowRoot.querySelector('[part="title"]');
    const price = card.shadowRoot.querySelector('[part="price"]');
    return {
      titleColor: getComputedStyle(title).color,
      titleLetterSpacing: getComputedStyle(title).letterSpacing,
      priceColor: getComputedStyle(price).color,
      priceTextShadow: getComputedStyle(price).textShadow,
    };
  }, CARD);
  check(
    'part: ::part(title) color overrides the plain Plasmic declaration',
    partStyles.titleColor === 'rgb(255, 0, 0)',
    partStyles.titleColor
  );
  check(
    'part: trusted static CSS survives the part override',
    partStyles.titleLetterSpacing !== 'normal' && partStyles.priceTextShadow !== 'none',
    `letter-spacing=${partStyles.titleLetterSpacing} text-shadow=${partStyles.priceTextShadow}`
  );
  check('part: price part is untouched', partStyles.priceColor === 'rgb(51, 65, 85)', partStyles.priceColor);
  await page.locator('.chip-close').click().catch(() => {});

  // --- Mobile override: 767px media query + a device-scoped edit ---
  await page.evaluate(() => window.__harness.controller().setDevice('Mobile'));
  await page.waitForTimeout(500);
  const mobile = await canvasEval((tag) => {
    const card = document.querySelector(tag);
    const grid = card.closest('div');
    const price = card.shadowRoot.querySelector('[part="price"]');
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      priceSize: getComputedStyle(price).fontSize,
    };
  }, CARD);
  check('responsive: mobile grid collapses to one column', mobile.columns === 1, `columns=${mobile.columns}`);
  check('responsive: generated 767px media query applies (price 24px)', mobile.priceSize === '24px', mobile.priceSize);

  // Device-scoped host edit while Mobile is active.
  await firstCard.click({ position: { x: 10, y: 10 } });
  const mobilePadding = page
    .locator('.gjs-sm-property', { hasText: 'Padding' })
    .locator('input[type="text"], input:not([type])')
    .first();
  let mobileOverrideOk = false;
  try {
    await mobilePadding.waitFor({ timeout: 4000 });
    await mobilePadding.fill('8px');
    await mobilePadding.press('Enter');
    await page.waitForTimeout(300);
    const paddings = await canvasEval((tag) => {
      const card = document.querySelector(tag);
      return getComputedStyle(card).paddingTop;
    }, CARD);
    mobileOverrideOk = paddings === '8px';
  } catch {
    mobileOverrideOk = false;
  }
  check('responsive: device-scoped host padding override applies on Mobile', mobileOverrideOk);
  await page.evaluate(() => window.__harness.controller().setDevice('Desktop'));
  await page.waitForTimeout(400);
  const desktopPadding = await canvasEval((tag) => getComputedStyle(document.querySelector(tag)).paddingTop, CARD);
  check('responsive: desktop padding unaffected by the mobile override', desktopPadding === '24px', desktopPadding);

  // --- Save, reload, verify persistence of everything ---
  await page.evaluate(() => window.__harness.controller().save());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForCanvas();
  const afterReload = await canvasEval((tag) => {
    const card = document.querySelector(tag);
    const grid = card.closest('div');
    const title = card.shadowRoot.querySelector('[part="title"]');
    const label = card.shadowRoot.querySelector('[data-edit="pricelabel"]');
    return {
      labelAttr: card.getAttribute('pricelabel'),
      labelText: label?.textContent?.trim(),
      titleColor: getComputedStyle(title).color,
      background: getComputedStyle(card).backgroundColor,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    };
  }, CARD);
  check('reload: pricelabel trait survives save/reload', afterReload.labelAttr === MARKER, String(afterReload.labelAttr));
  check('reload: bound text renders the saved trait value', afterReload.labelText === MARKER, String(afterReload.labelText));
  check('reload: part style survives', afterReload.titleColor === 'rgb(255, 0, 0)', afterReload.titleColor);
  check('reload: host style survives', afterReload.background === 'rgb(0, 255, 0)', afterReload.background);
  check('reload: generated page composition intact (grid 3 cols)', afterReload.columns === 3, `columns=${afterReload.columns}`);

  // --- Publish and inspect serialized output ---
  await page.evaluate(() => window.__harness.controller().publish());
  await page.waitForTimeout(300);
  const dump = await page.evaluate(() => window.__harness.dump());
  const publishedKeys = Object.keys(dump).filter((key) => !key.endsWith('.draft'));
  const publishedBlob = publishedKeys.map((key) => dump[key]).join('\n');
  check('publish: artifact + embeds written', publishedKeys.length > 0, publishedKeys.join(', '));
  check('publish: serialized HTML carries the lowercase pricelabel attribute', publishedBlob.includes('pricelabel'));
  check('publish: serialized HTML does not contain camelCase priceLabel', !publishedBlob.includes('priceLabel'));
  check('publish: page <style> CSS reaches published output', publishedBlob.includes('grid-template-columns'));
} finally {
  await browser.close();
  server.close();
}

// --- The editor itself must be untouched ---
const gitStatus = execFileSync('git', ['status', '--porcelain', '--', 'archura-editor/src'], {
  cwd: join(here, '..', '..'),
}).toString().trim();
check('boundary: no source file under archura-editor/src changed', gitStatus === '', gitStatus);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
