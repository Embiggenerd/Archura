// Verification for GAPS_AND_SOLUTIONS §3: code-composed pages, locked structure,
// editing-target breadcrumb. Usage: node scripts/verify-section3.mjs (vite on :5199)
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

// Start from template defaults, not a previously published artifact
rmSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts'), { recursive: true, force: true });

const BASE = 'http://localhost:5199';
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

try {
  // --- 1. Page target renders the full composition ---
  await page.goto(`${BASE}/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 15000 });
  const cardCount = await frame.locator('archura-card').count();
  check('page: hero + two cards render from the Landing template', cardCount === 2, `cards: ${cardCount}`);
  check(
    'page: no live page element in the canvas (expansion, not embedding)',
    (await frame.locator('archura-landing').count()) === 0
  );

  // --- 2. Breadcrumb shows the editing target ---
  const crumb = page.locator('.breadcrumb');
  check('breadcrumb: shows "Pages / Landing"', /Pages\s*\/\s*Landing/.test(await crumb.innerText()), await crumb.innerText());

  // --- 3. Structure is locked ---
  const firstCard = frame.locator('archura-card').first();
  await firstCard.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  check('page: selected card survives Delete/Backspace', (await frame.locator('archura-card').count()) === 2);

  // --- 4. Style one card independently, save ---
  await page.evaluate(() => {
    window.__artifacts = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => {
      window.__artifacts = e.detail.artifacts;
    });
  });
  const fontSize = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fontSize.waitFor({ state: 'visible', timeout: 10000 });
  await fontSize.fill('24');
  await fontSize.press('Enter');
  await page.getByRole('button', { name: /Save|Publish/ }).click();
  await page.waitForFunction(() => window.__artifacts !== null, null, { timeout: 10000 });
  const artifact = (await page.evaluate(() => window.__artifacts))[0];

  const cardsInHtml = [...artifact.snapshot.html.matchAll(/<archura-card[^>]*>/g)].map((m) => m[0]);
  check(
    'save: --font-size inlined on the styled card only',
    cardsInHtml.length === 2 &&
      /--font-size:\s*24px/.test(cardsInHtml[0]) &&
      !/--font-size/.test(cardsInHtml[1]),
    JSON.stringify(cardsInHtml)
  );
  const content = artifact.content?.components ?? [];
  const hero = content.find((c) => c.tagName === 'archura-hero');
  const cards = content.filter((c) => c.tagName === 'archura-card');
  check(
    'save: content.components has hero + both cards with their attributes',
    content.length === 3 &&
      hero?.componentPath.join('/') === 'heroes/Hero' &&
      hero?.attributes.heading === 'Welcome to Archura' &&
      cards.length === 2 &&
      cards[0]?.attributes.title === 'First Feature' &&
      cards[1]?.attributes.title === 'Second Feature',
    JSON.stringify(content)
  );
  check('save: artifact identity is the page', artifact.config.componentPath.join('/') === 'pages/Landing');

  // --- 5. Round trip: fresh controller from the saved artifact ---
  await page.evaluate(async (artifact) => {
    const { ArchuraEditorController } = await import('/src/editor/ArchuraEditorController.ts');
    const host = document.createElement('div');
    host.id = 'roundtrip-host';
    host.style.cssText = 'width:1000px;height:500px;';
    document.body.appendChild(host);
    const controller = new ArchuraEditorController({ initialArtifact: artifact });
    await controller.init();
    controller.mountCanvas(host);
  }, artifact);
  const rtFrame = page.frameLocator('#roundtrip-host iframe.gjs-frame');
  await rtFrame.locator('archura-hero').waitFor({ state: 'visible', timeout: 15000 });
  const rtStyles = await rtFrame.locator('archura-card').evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).getPropertyValue('--font-size').trim())
  );
  check(
    'round trip: page restores with per-card styling intact',
    rtStyles.length === 2 && rtStyles[0] === '24px' && rtStyles[1] !== '24px',
    JSON.stringify(rtStyles)
  );

  // --- 6. Deploy: snapshot renders standalone (leaf modules only via page import) ---
  const deployPage = await browser.newPage();
  await deployPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await deployPage.evaluate(async ({ snapshot }) => {
    document.body.innerHTML = `<style>${snapshot.css}</style>${snapshot.html}`;
    await import('/src/components/heroes/Hero.js');
    await import('/src/components/cards/Card.js');
  }, artifact);
  await deployPage.locator('archura-hero').waitFor({ state: 'visible', timeout: 10000 });
  const deployed = await deployPage.evaluate(() => ({
    heroHeading: document.querySelector('archura-hero')?.shadowRoot?.querySelector('h1')?.textContent,
    cardProps: [...document.querySelectorAll('archura-card')].map((el) =>
      getComputedStyle(el).getPropertyValue('--font-size').trim()
    ),
    rowDisplay: getComputedStyle(document.querySelector('archura-card').parentElement).display,
  }));
  check(
    'deploy: standalone page renders hero, per-card styles, and layout',
    deployed.heroHeading === 'Welcome to Archura' &&
      deployed.cardProps[0] === '24px' &&
      deployed.cardProps[1] !== '24px' &&
      deployed.rowDisplay === 'flex',
    JSON.stringify(deployed)
  );
  await deployPage.close();

  // --- 7. Breadcrumb regression for component targets ---
  await page.goto(`${BASE}/?component=cards/Card`, { waitUntil: 'domcontentloaded' });
  await page.frameLocator('iframe.gjs-frame').locator('archura-card').waitFor({ state: 'visible', timeout: 15000 });
  const compCrumb = await page.locator('.breadcrumb').innerText();
  check('breadcrumb: shows "Components / Card" for component targets', /Components\s*\/\s*Card/.test(compCrumb), compCrumb);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
