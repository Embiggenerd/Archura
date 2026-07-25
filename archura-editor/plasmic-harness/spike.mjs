// Step 0 spike: load the hand-written "generated" fixture through the
// unchanged Archura editor and answer, empirically:
//   1. Does a <style> child of a PageBase light-DOM render survive expansion,
//      GrapesJS parsing, save, reload, and publish output?
//   2. Are generated leaves selectable/editable while wrappers stay locked?
//   3. Do a trait edit and a part style survive save + reload?
// Prints PASS/FAIL per check; exits 1 if any check fails.
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const PORT = Number(process.env.HARNESS_PORT || 5610);
const URL_ROOT = `http://localhost:${PORT}/`;
const CARD = 'archura-fixture-pricingcard-k3x9q2';
const MARKER = `Spike ${Date.now().toString(36)}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
};

const server = await startServer(PORT);
const browser = await chromium.launch({ headless: !process.env.HEADED });
// Wide enough that the desktop canvas frame exceeds the 991px tablet
// breakpoint after the editor's side panels take their share.
const page = await browser.newPage({ viewport: { width: 1760, height: 960 } });
page.on('pageerror', (error) => console.log(`page error: ${error.message}`));

const frameEl = () => page.frameLocator('iframe.gjs-frame');

async function waitForCanvas() {
  await frameEl().locator(CARD).first().waitFor({ state: 'visible', timeout: 30000 });
}

async function canvasEval(fn, arg) {
  const handle = await page.locator('iframe.gjs-frame').elementHandle();
  const frame = await handle.contentFrame();
  return frame.evaluate(fn, arg);
}

try {
  await page.goto(URL_ROOT, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__harness);
  await page.evaluate(() => window.__harness.reset());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForCanvas();
  const cardCount = await frameEl().locator(CARD).count();
  check('load: fixture page renders three pricing cards', cardCount === 3, `count=${cardCount}`);

  // --- Spike core: <style> after expansion/parsing ---
  const styleInfo = await canvasEval(() => {
    const styles = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '');
    const grid = document.querySelector('.fx-grid');
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
    const free = document.querySelector('.fx-free');
    return {
      hasFxStyle: styles.some((s) => s.includes('.fx-grid')),
      display: grid ? getComputedStyle(grid).display : 'missing',
      columns,
      freePosition: free ? getComputedStyle(free).position : 'missing',
    };
  });
  check('expand: <style> child present in canvas document', styleInfo.hasFxStyle);
  check(
    'expand: grid layout applies at desktop',
    styleInfo.display === 'grid' && styleInfo.columns === 3,
    `display=${styleInfo.display} columns=${styleInfo.columns}`
  );
  check('expand: free-positioned element is absolute', styleInfo.freePosition === 'absolute', styleInfo.freePosition);

  // --- Structure lock ---
  await frameEl().locator('.fx-hero').click({ position: { x: 8, y: 8 }, force: true });
  const heroSelected = await canvasEval(() => document.querySelector('.fx-hero')?.classList.contains('gjs-selected'));
  check('lock: hero wrapper is not selectable', heroSelected === false, String(heroSelected));

  const firstCard = frameEl().locator(CARD).first();
  await firstCard.click({ position: { x: 10, y: 10 } });
  const cardSelected = await canvasEval(
    (tag) => document.querySelector(tag)?.classList.contains('gjs-selected'),
    CARD
  );
  check('select: pricing card host is selectable', cardSelected === true, String(cardSelected));

  // --- Trait edit through inline editing (data-edit="name") ---
  await frameEl().locator(`${CARD} .title`).first().dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(MARKER);
  await frameEl().locator('.fx-hero').click({ position: { x: 8, y: 8 }, force: true });
  let nameAttr = '';
  for (let i = 0; i < 25; i++) {
    nameAttr = (await firstCard.getAttribute('name')) ?? '';
    if (nameAttr === MARKER) break;
    await page.waitForTimeout(200);
  }
  check('trait: inline edit commits to the name attribute', nameAttr === MARKER, nameAttr);

  // --- Part style through the Selected Part sector ---
  await firstCard.click({ position: { x: 10, y: 10 } });
  await frameEl().locator(`${CARD} .title`).first().click();
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
    return {
      title: getComputedStyle(card.shadowRoot.querySelector('.title')).color,
      price: getComputedStyle(card.shadowRoot.querySelector('.price')).color,
    };
  }, CARD);
  check(
    'part: ::part(title) override beats plain shadow declaration, price untouched',
    partStyles.title === 'rgb(255, 0, 0)' && partStyles.price !== 'rgb(255, 0, 0)',
    JSON.stringify(partStyles)
  );

  // --- Save, reload, verify persistence ---
  await page.evaluate(() => window.__harness.controller().save());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForCanvas();
  const afterReload = await canvasEval((tag) => {
    const card = document.querySelector(tag);
    const grid = document.querySelector('.fx-grid');
    const styles = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '');
    return {
      name: card?.getAttribute('name'),
      titleColor: card ? getComputedStyle(card.shadowRoot.querySelector('.title')).color : 'missing',
      hasFxStyle: styles.some((s) => s.includes('.fx-grid')),
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    };
  }, CARD);
  check('reload: trait edit survives save/reload', afterReload.name === MARKER, String(afterReload.name));
  check('reload: part style survives save/reload', afterReload.titleColor === 'rgb(255, 0, 0)', afterReload.titleColor);
  check('reload: <style> child survives save/reload', afterReload.hasFxStyle === true);
  check('reload: grid layout still applies', afterReload.columns === 3, `columns=${afterReload.columns}`);

  // --- Responsive: Mobile device applies the 767px media query ---
  await page.evaluate(() => window.__harness.controller().setDevice('Mobile'));
  await page.waitForTimeout(500);
  const mobileColumns = await canvasEval(() => {
    const grid = document.querySelector('.fx-grid');
    return grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0;
  });
  check('responsive: mobile grid collapses to one column', mobileColumns === 1, `columns=${mobileColumns}`);
  await page.evaluate(() => window.__harness.controller().setDevice('Desktop'));

  // --- Publish and inspect the store ---
  await page.evaluate(() => window.__harness.controller().publish());
  await page.waitForTimeout(300);
  const dump = await page.evaluate(() => window.__harness.dump());
  const keys = Object.keys(dump).sort();
  console.log(`store keys after publish: ${keys.join(', ')}`);
  const fxCarriers = keys.filter((key) => dump[key].includes('.fx-grid'));
  const markerCarriers = keys.filter((key) => dump[key].includes(MARKER));
  console.log(`keys containing .fx-grid CSS: ${fxCarriers.join(', ') || '(none)'}`);
  console.log(`keys containing the trait marker: ${markerCarriers.join(', ') || '(none)'}`);
  check(
    'publish: page style reaches published artifact output',
    fxCarriers.some((key) => !key.endsWith('.draft')),
    fxCarriers.join(', ')
  );
  check(
    'publish: trait edit reaches published output',
    markerCarriers.some((key) => !key.endsWith('.draft')),
    markerCarriers.join(', ')
  );
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
