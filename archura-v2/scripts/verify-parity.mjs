// Verification for EDITOR_PARITY.md: assets, responsive, theme tokens, fonts,
// ergonomics, page meta, animation presets.
// Usage: node scripts/verify-parity.mjs (vite on :5199; wrangler dev on :8787 with built dist/)
import { chromium } from 'playwright';

const VITE = 'http://localhost:5199';
const WORKER = 'http://localhost:8787';
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

try {
  await page.goto(`${VITE}/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });

  // --- 1. transform unit checks: media split + theme skip ---
  const t = await page.evaluate(async () => {
    const { transformForDeployment } = await import('/src/editor/ArchuraEditorController.ts');
    return {
      media: transformForDeployment(
        '<div id="a"></div>',
        '#a { --x: 1px; --y: 2px; }\n@media (max-width: 767px) { #a { --x: 3px; } }'
      ),
      theme: transformForDeployment('<div id="a"></div>', 'body { --color: red; }\n#a { --color: blue; }'),
    };
  });
  check(
    'transform: media-overridden prop stays in css, others inline',
    /--y:\s*2px/.test(t.media.html) &&
      !/--x/.test(t.media.html) &&
      /#a\s*{[^}]*--x:\s*1px/.test(t.media.css) &&
      /@media[^{]*{\s*#a\s*{[^}]*--x:\s*3px/.test(t.media.css),
    JSON.stringify(t.media)
  );
  check(
    'transform: body/theme rules kept whole, instance rules still inline',
    /body\s*{[^}]*--color:\s*red/.test(t.theme.css) && /--color:\s*blue/.test(t.theme.html),
    JSON.stringify(t.theme)
  );

  // --- 2. Editor flow on the Landing page ---
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await page.evaluate(() => {
    window.__artifacts = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => {
      window.__artifacts = e.detail.artifacts;
    });
  });

  // Asset upload through the hero's logo trait
  await frame.locator('archura-hero').click();
  const fileInput = page.locator('.traits-root input[type="file"]');
  await fileInput.waitFor({ state: 'attached', timeout: 10000 });
  await fileInput.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1PX });
  await frame.locator('archura-hero img.logo').waitFor({ state: 'attached', timeout: 10000 });
  check('assets: uploaded logo renders in the hero slot', true);

  // Dirty indicator appears once edited
  check('ergonomics: dirty indicator shows after an edit', await page.locator('.dirty').isVisible());

  // Undo reverts a trait edit
  const titleInput = page
    .locator('.gjs-trt-trait', { has: page.locator('.gjs-label', { hasText: /^Heading$/ }) })
    .locator('input');
  await frame.locator('archura-hero').click();
  await titleInput.fill('Changed Heading');
  await titleInput.press('Enter');
  await page.waitForFunction(
    () =>
      document
        .querySelector('iframe')
        ?.contentDocument?.querySelector('archura-hero')
        ?.getAttribute('heading') === 'Changed Heading',
    null,
    { timeout: 5000 }
  ).catch(() => {});
  await page.getByTitle('Undo').click();
  const heading = await frame.locator('archura-hero').getAttribute('heading');
  check('ergonomics: undo reverts the trait edit', heading !== 'Changed Heading', `heading="${heading}"`);

  // Animation preset via select trait
  await frame.locator('archura-card').first().click({ position: { x: 10, y: 10 } });
  const animSelect = page.locator('.gjs-trt-trait', { hasText: 'Animation' }).locator('select');
  await animSelect.selectOption('fade-up');

  // Desktop style, then a mobile override on the same card
  const fontSize = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fontSize.waitFor({ state: 'visible', timeout: 10000 });
  await fontSize.fill('24');
  await fontSize.press('Enter');
  await page.getByRole('button', { name: 'Mobile' }).click();
  await frame.locator('archura-card').first().click({ position: { x: 10, y: 10 } });
  await fontSize.fill('13');
  await fontSize.press('Enter');
  await page.getByRole('button', { name: 'Desktop' }).click();

  // Theme tokens + Google font via the Theme panel
  await page.getByRole('button', { name: 'Theme' }).click();
  const textColor = page.locator('.panel label', { hasText: 'Text color' }).locator('input');
  await textColor.fill('#ff0000');
  await page.locator('.panel select').selectOption(`'Poppins', sans-serif`);
  // Base has `transition: all .2s`; poll past it
  await page
    .waitForFunction(
      () => {
        const card = document.querySelector('iframe')?.contentDocument?.querySelector('archura-card');
        return card ? getComputedStyle(card).color === 'rgb(255, 0, 0)' : false;
      },
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  const cardColor = await frame
    .locator('archura-card')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  check('theme: body token restyles components live', cardColor === 'rgb(255, 0, 0)', cardColor);

  // Page meta via the Page panel
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const metaTitle = page.locator('.panel label', { hasText: 'Page title' }).locator('input');
  await metaTitle.fill('Parity Landing');
  await metaTitle.press('Enter');
  const metaDesc = page.locator('.panel label', { hasText: 'Description' }).locator('input');
  await metaDesc.fill('A page that proves the parity arc.');
  await metaDesc.press('Enter');

  // Publish and inspect the artifact
  await page.getByRole('button', { name: /Publish|Save/ }).click();
  await page.waitForFunction(() => window.__artifacts !== null, null, { timeout: 10000 });
  const artifact = (await page.evaluate(() => window.__artifacts))[0];

  check(
    'assets: artifact stores the absolute asset URL on the hero',
    /<archura-hero[^>]*logosrc="http:\/\/localhost:5199\/api\/assets\/dev\/[0-9a-f]{12}\.png"/.test(
      artifact.snapshot.html
    ),
    artifact.snapshot.html.slice(0, 300)
  );
  const firstCard = artifact.snapshot.html.match(/<archura-card[^>]*>/)?.[0] ?? '';
  check(
    'responsive: media-overridden font-size not inlined; both values in css',
    !/--font-size/.test(firstCard) &&
      /--font-size:\s*24px/.test(artifact.snapshot.css) &&
      /@media[^{]*max-width:\s*767px[^{]*{[^]*--font-size:\s*13px/.test(artifact.snapshot.css),
    firstCard + ' ||| ' + artifact.snapshot.css
  );
  check(
    'theme: body rule with tokens and Poppins survives into snapshot.css',
    /body\s*{[^}]*--color:\s*#ff0000/.test(artifact.snapshot.css) &&
      artifact.snapshot.css.includes('Poppins'),
    artifact.snapshot.css
  );
  check(
    'animation: fade-up recorded on the card',
    /<archura-card[^>]*animation="fade-up"/.test(artifact.snapshot.html),
    firstCard
  );
  check(
    'seo: page meta captured in artifact content',
    artifact.content?.page?.title === 'Parity Landing' &&
      artifact.content?.page?.description === 'A page that proves the parity arc.',
    JSON.stringify(artifact.content?.page)
  );
  check('ergonomics: dirty indicator clears after publish', !(await page.locator('.dirty').isVisible()));

  // --- 3. Served shell on the Worker: meta, fonts, assets (Node-side, no CORS) ---
  const claim = await fetch(`${WORKER}/api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site: `parity-${Date.now().toString(36)}` }),
  });
  const { site, token } = await claim.json();
  await fetch(`${WORKER}/api/artifacts/${site}/pages/Landing`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(artifact),
  });
  const shellHtml = await (await fetch(`${WORKER}/s/${site}/`)).text();

  const assetPut = await fetch(`${WORKER}/api/assets/${site}/logo.png`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: PNG_1PX,
  });
  const { url: assetUrl } = await assetPut.json();
  // wrangler dev reports the route host (archura.ai) as origin; fetch locally
  const assetGet = await fetch(new URL(new URL(assetUrl).pathname, WORKER));
  const workerChecks = {
    html: shellHtml,
    assetStatus: assetGet.status,
    assetCache: assetGet.headers.get('Cache-Control') ?? '',
    assetUrl,
  };
  check(
    'shell: served page carries title, description, og tags',
    workerChecks.html.includes('<title>Parity Landing</title>') &&
      workerChecks.html.includes('A page that proves the parity arc.') &&
      workerChecks.html.includes('og:title'),
    workerChecks.html.slice(0, 400)
  );
  check(
    'shell: Google Fonts link emitted only for used families',
    workerChecks.html.includes('family=Poppins') && !workerChecks.html.includes('family=Merriweather'),
    workerChecks.html.match(/fonts\.googleapis[^"]*/)?.[0] ?? 'no font link'
  );
  check(
    'shell: worker asset pipeline stores content-hashed, immutable images',
    workerChecks.assetStatus === 200 &&
      workerChecks.assetCache.includes('immutable') &&
      /\/[0-9a-f]{12}\.png$/.test(workerChecks.assetUrl),
    JSON.stringify({ status: workerChecks.assetStatus, cache: workerChecks.assetCache, url: workerChecks.assetUrl })
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
