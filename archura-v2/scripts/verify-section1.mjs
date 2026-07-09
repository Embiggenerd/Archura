// Verification for GAPS_AND_SOLUTIONS §1: save/load round trip + deployment transform.
// Usage: node scripts/verify-section1.mjs (expects vite dev server on :5199)
import { chromium } from 'playwright';

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
  await page.goto(`${BASE}/?component=cards/Card`, { waitUntil: 'domcontentloaded' });

  // --- 1. transformForDeployment unit checks (pure function, run in page realm) ---
  const t = await page.evaluate(async () => {
    const { transformForDeployment } = await import('/src/editor/ArchuraEditorController.ts');
    return {
      multi: transformForDeployment(
        '<div id="c1"></div><div id="c2"></div>',
        '#c1 { --color: red; padding: 4px; }\n#c2 { --color: blue; }\n.unmatched { --x: 1; }\n#c1:hover { --color: green; }'
      ),
      noProps: transformForDeployment('<p>hi</p>', 'p { margin: 0; }'),
    };
  });

  check(
    'transform: props inlined per matching element',
    t.multi.html.includes('id="c1"') &&
      /id="c1"[^>]*style="[^"]*--color:\s*red/.test(t.multi.html) &&
      /id="c2"[^>]*style="[^"]*--color:\s*blue/.test(t.multi.html) &&
      !/id="c2"[^>]*red/.test(t.multi.html),
    t.multi.html
  );
  check(
    'transform: non-custom-prop CSS kept, inlined props removed',
    t.multi.css.includes('padding') && !/#c1\s*{[^}]*--color/.test(t.multi.css),
    t.multi.css
  );
  check(
    'transform: unmatched/hover rules kept verbatim',
    t.multi.css.includes('.unmatched') && t.multi.css.includes(':hover'),
    t.multi.css
  );
  check(
    'transform: no custom props → untouched',
    t.noProps.html === '<p>hi</p>' && t.noProps.css.includes('margin'),
    JSON.stringify(t.noProps)
  );

  // --- 2. UI flow: default load, style edit, save ---
  const frame = page.frameLocator('iframe.gjs-frame');
  const card = frame.locator('archura-card');
  await card.waitFor({ state: 'visible', timeout: 15000 });
  check('editor: card renders with trait defaults', (await card.getAttribute('title')) === 'Card Title');

  await page.evaluate(() => {
    window.__artifacts = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => {
      window.__artifacts = e.detail.artifacts;
    });
  });

  await card.click();
  const fontSize = page
    .locator('.gjs-sm-property', { hasText: 'Font Size' })
    .locator('input')
    .first();
  await fontSize.waitFor({ state: 'visible', timeout: 10000 });
  await fontSize.fill('24');
  await fontSize.press('Enter');

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => window.__artifacts !== null, null, { timeout: 10000 });
  const artifact = (await page.evaluate(() => window.__artifacts))[0];

  check(
    'save: --font-size inlined on the card element',
    /<archura-card[^>]*style="[^"]*--font-size:\s*24px/.test(artifact.snapshot.html),
    artifact.snapshot.html
  );
  check(
    'save: snapshot css has no leftover --font-size rule',
    !artifact.snapshot.css.includes('--font-size'),
    artifact.snapshot.css
  );
  const entry = artifact.content?.components?.[0];
  check(
    'save: content.components populated with attributes',
    entry &&
      entry.tagName === 'archura-card' &&
      entry.componentPath.join('/') === 'cards/Card' &&
      entry.attributes.title === 'Card Title' &&
      typeof entry.instanceId === 'string',
    JSON.stringify(artifact.content)
  );

  // --- 3. Round trip: fresh controller from the saved artifact ---
  await page.evaluate(async (artifact) => {
    const { ArchuraEditorController } = await import('/src/editor/ArchuraEditorController.ts');
    const host = document.createElement('div');
    host.id = 'roundtrip-host';
    host.style.cssText = 'width:800px;height:400px;';
    document.body.appendChild(host);
    const controller = new ArchuraEditorController({ initialArtifact: artifact });
    await controller.init();
    controller.mountCanvas(host);
  }, artifact);

  const rtCard = page.frameLocator('#roundtrip-host iframe.gjs-frame').locator('archura-card');
  await rtCard.waitFor({ state: 'visible', timeout: 15000 });
  check(
    'round trip: card restored with saved attributes',
    (await rtCard.getAttribute('title')) === 'Card Title'
  );
  const rtFontSize = await rtCard.evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  check('round trip: saved --font-size style survives reload', rtFontSize === '24px', `got "${rtFontSize}"`);

  // --- 4. Deploy: snapshot renders standalone, no editor code loaded ---
  const deployPage = await browser.newPage();
  await deployPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await deployPage.evaluate(async ({ snapshot }) => {
    document.body.innerHTML = `<style>${snapshot.css}</style>${snapshot.html}`;
    await import('/src/components/cards/Card.js');
  }, artifact);
  const deployedCard = deployPage.locator('archura-card');
  await deployedCard.waitFor({ state: 'visible', timeout: 10000 });
  // Base sets `transition: all .2s`, so font-size animates 16→24px; wait it out
  await deployPage
    .waitForFunction(
      () => parseFloat(getComputedStyle(document.querySelector('archura-card')).fontSize) > 23.5,
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  const deployed = await deployedCard.evaluate((el) => ({
    fontSize: getComputedStyle(el).getPropertyValue('--font-size').trim(),
    renderedFontSize: parseFloat(getComputedStyle(el).fontSize),
    title: el.shadowRoot?.querySelector('h3')?.textContent,
  }));
  check(
    'deploy: standalone snapshot renders with saved styles',
    deployed.fontSize === '24px' &&
      Math.abs(deployed.renderedFontSize - 24) < 0.5 &&
      deployed.title === 'Card Title',
    JSON.stringify(deployed)
  );
  await deployPage.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
