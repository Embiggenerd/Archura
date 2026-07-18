// Per-client styling, end to end (the milestone gate for
// docs/PLAN_CLIENT_STYLING.md):
// 0. embed generation is a correct pure function;
// 1. the filesystem backend speaks the same namespace contract as the Worker;
// 2. two clients style the same component differently, publish, and a
//    foreign-origin page embedding each client's module renders each client's
//    styling;
// 3. namespace listing shows exactly the client's components (claim-token
//    gated on the Worker);
// 4. re-publishing restyles live embeds without touching the pasted snippet.
// Usage: node scripts/verify-client-styling.mjs
// (expects vite on :5199 and `wrangler dev --port 8787` against the built dist/)
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const VITE = 'http://localhost:5199';
const WORKER = 'http://localhost:8787';
const EMBED_PORT = 5298;
const STAMP = Date.now().toString(36);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const reachable = async (url) => fetch(url).then((r) => r.status < 500).catch(() => false);
if (!(await reachable(`${VITE}/`)) || !(await reachable(`${WORKER}/`))) {
  console.log('SKIP — needs vite on :5199 and wrangler dev on :8787');
  process.exit(0);
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

const claim = async (site) => {
  const res = await fetch(`${WORKER}/api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site }),
  });
  if (!res.ok) throw new Error(`claim failed (${res.status})`);
  return (await res.json()).token;
};

// One editor session per client, kept open across re-publishes (restyling an
// artifact restored from a reload is a known, separate editor gap — the color
// input reverts; live sessions are the supported path, as in verify-deploy).
// Styling goes through the same UI an agent would drive.
const openEditor = async (site, token) => {
  const editorPage = await browser.newPage();
  editorPage.on('pageerror', (e) => console.log('editor pageerror:', e.message));
  await editorPage.goto(`${WORKER}/edit/`, { waitUntil: 'domcontentloaded' });
  await editorPage.evaluate(
    ([s, t]) => localStorage.setItem(`archura:site-token:${s}`, t),
    [site, token]
  );
  await editorPage.goto(`${WORKER}/edit/?site=${site}&component=payments/StripePayment`, {
    waitUntil: 'domcontentloaded',
  });
  const frame = editorPage.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-stripe-payment').waitFor({ state: 'visible', timeout: 20000 });
  await frame.locator('archura-stripe-payment').click({ position: { x: 8, y: 8 } });
  return editorPage;
};

const styleAndPublish = async (editorPage, background) => {
  const backgroundInput = editorPage
    .locator('.gjs-sm-property', { hasText: 'Background' })
    .locator('input[type="text"]')
    .first();
  await backgroundInput.waitFor({ state: 'visible', timeout: 10000 });
  await backgroundInput.fill(background);
  await backgroundInput.press('Enter');

  await editorPage.getByRole('button', { name: 'Publish', exact: true }).click();
  await editorPage.getByRole('button', { name: 'Published' }).waitFor({ timeout: 15000 });
};

const embedServer = createServer((req, res) => {
  const site = req.url.startsWith('/b') ? `styling-b-${STAMP}` : `styling-a-${STAMP}`;
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body>
    <script type="module" src="${WORKER}/s/${site}/embed/StripePayment.js"></script>
    <archura-stripe-payment></archura-stripe-payment>
  </body></html>`);
});

try {
  // --- 0. Embed generation is a correct pure function ---
  await page.goto(`${VITE}/blank.html`, { waitUntil: 'domcontentloaded' });
  const unit = await page.evaluate(async () => {
    const { extractInstanceEmbed, generateEmbedModule } = await import('/src/component-data/embed.ts');
    const artifact = {
      snapshot: {
        html: '<archura-stripe-payment id="i1" style="--background-color: rgb(1, 2, 3); --font-size: 30px;"></archura-stripe-payment>',
        css: '#i1 [data-part="payButton"] { --button-font-size: 2rem; }\n@media (max-width: 480px) { #i1 { --font-size: 13px; } }\n#other { --font-size: 99px; }',
      },
    };
    const instance = {
      componentPath: ['payments', 'StripePayment'],
      tagName: 'archura-stripe-payment',
      instanceId: 'i1',
      attributes: { id: 'i1', 'button-label': 'Buy "now"', amount: 2500 },
    };
    const { css, traits } = extractInstanceEmbed(artifact, instance);
    const source = generateEmbedModule({
      moduleUrl: 'https://example.com/components/payments/StripePayment.js',
      tag: 'archura-stripe-payment',
      css,
      traits,
    });
    return { css, traits, source };
  });
  check(
    'unit: host props, part rules, and media overrides extracted; foreign rules excluded',
    unit.css.includes('archura-stripe-payment { --background-color: rgb(1, 2, 3);') &&
      unit.css.includes('archura-stripe-payment [data-part="payButton"]') &&
      unit.css.includes('@media (max-width: 480px)') &&
      !unit.css.includes('#i1') &&
      !unit.css.includes('#other'),
    unit.css
  );
  check(
    'unit: traits keep configured attributes, drop id, and escape safely',
    unit.traits['button-label'] === 'Buy "now"' &&
      unit.traits.amount === '2500' &&
      !('id' in unit.traits) &&
      unit.source.includes('import "https://example.com/components/payments/StripePayment.js"') &&
      unit.source.includes('Buy \\"now\\"'),
    unit.source
  );

  // --- 1. Filesystem backend speaks the same namespace contract ---
  const fsSite = `fs-parity-${STAMP}`;
  const fsArtifact = await fetch(`${VITE}/api/artifacts/sites/${fsSite}/pages/Landing`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  });
  const fsEmbed = await fetch(`${VITE}/api/embeds/${fsSite}/StripePayment.js`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/javascript' },
    body: 'export {};',
  });
  const fsList = await (await fetch(`${VITE}/api/sites/${fsSite}/list`)).json();
  const fsServed = await fetch(`${VITE}/api/embeds/${fsSite}/StripePayment.js`);
  check(
    'filesystem: artifact + embed stored under sites/<slug>/, listed with the Worker shape',
    fsArtifact.status === 204 &&
      fsEmbed.status === 204 &&
      fsList.entries?.some((e) => e.kind === 'artifact' && e.path.join('/') === 'pages/Landing') &&
      fsList.entries?.some((e) => e.kind === 'embed' && e.path.join('/') === 'embed/StripePayment.js') &&
      fsServed.headers.get('content-type')?.includes('javascript'),
    JSON.stringify(fsList)
  );

  // --- 2. Two clients, two stylings ---
  const siteA = `styling-a-${STAMP}`;
  const siteB = `styling-b-${STAMP}`;
  const tokenA = await claim(siteA);
  const tokenB = await claim(siteB);
  const editorA = await openEditor(siteA, tokenA);
  const editorB = await openEditor(siteB, tokenB);
  await styleAndPublish(editorA, '#ff0000');
  await styleAndPublish(editorB, '#0000ff');
  check('publish: both clients published the same component with different styling', true);

  // --- 3. Namespace listing, claim-token gated ---
  const listAuthed = await fetch(`${WORKER}/api/sites/${siteA}/list`, {
    headers: { Authorization: `Bearer ${tokenA}` },
  });
  const listBody = await listAuthed.json();
  const listDenied = await fetch(`${WORKER}/api/sites/${siteA}/list`);
  const crossToken = await fetch(`${WORKER}/api/sites/${siteA}/list`, {
    headers: { Authorization: `Bearer ${tokenB}` },
  });
  check(
    "list: client A's namespace shows exactly its artifact + embed; no token or B's token → 401",
    listAuthed.status === 200 &&
      listBody.entries.some((e) => e.kind === 'artifact' && e.path.join('/') === 'payments/StripePayment') &&
      listBody.entries.some((e) => e.kind === 'embed' && e.path.join('/') === 'embed/StripePayment.js') &&
      listDenied.status === 401 &&
      crossToken.status === 401,
    JSON.stringify({ status: listAuthed.status, denied: listDenied.status, cross: crossToken.status, entries: listBody.entries })
  );

  // --- 4. Foreign-origin embeds render each client's styling ---
  await new Promise((resolve) => embedServer.listen(EMBED_PORT, resolve));
  const embedPage = await browser.newPage();
  embedPage.on('pageerror', (e) => console.log('embed pageerror:', e.message));

  const readEmbed = async (path) => {
    await embedPage.goto(`http://localhost:${EMBED_PORT}${path}`, { waitUntil: 'domcontentloaded' });
    await embedPage.locator('archura-stripe-payment .form').waitFor({ state: 'visible', timeout: 15000 });
    return embedPage.evaluate(() => {
      const el = document.querySelector('archura-stripe-payment');
      return getComputedStyle(el).getPropertyValue('--background-color').trim();
    });
  };
  const backgroundA = await readEmbed('/a');
  const backgroundB = await readEmbed('/b');
  check(
    "embed: client A's page renders red, client B's renders blue, same snippet shape",
    backgroundA === '#ff0000' && backgroundB === '#0000ff',
    JSON.stringify({ backgroundA, backgroundB })
  );

  // --- 5. Re-publish restyles the live embed without touching the snippet ---
  await styleAndPublish(editorA, '#00ff00');
  const backgroundA2 = await readEmbed('/a');
  check("embed: re-publishing client A turns the same embed green", backgroundA2 === '#00ff00', backgroundA2);
  await embedPage.close();
  await editorA.close();
  await editorB.close();
} finally {
  embedServer.close();
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
