// Verification for the demo deploy (site Worker): claim → edit → publish →
// served site → live update. Usage: node scripts/verify-deploy.mjs
// (expects `wrangler dev --port 8787` running against the built dist/)
import { chromium } from 'playwright';

const BASE = 'http://localhost:8787';
const SITE = `verify-${Date.now().toString(36)}`;
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

try {
  // --- 1. Claim a site through the UI (behind the anonymous bar's button) ---
  await page.goto(`${BASE}/edit/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.claim-open').click();
  await page.locator('.claim input').fill(SITE);
  await page.locator('.claim button').click();
  await page.waitForURL(`**/edit/?site=${SITE}`, { timeout: 10000 });
  const token = await page.evaluate((s) => localStorage.getItem(`archura:site-token:${s}`), SITE);
  check('claim: site claimed, token stored, editor opened', !!token);

  // --- 2. Editor loads with bundled component modules ---
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  check('editor: Landing renders from bundled /components modules', (await frame.locator('archura-card').count()) === 2);

  // --- 3. Style an element and publish ---
  await frame.locator('archura-card').first().click();
  const fontSize = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fontSize.waitFor({ state: 'visible', timeout: 10000 });
  await fontSize.fill('28');
  await fontSize.press('Enter');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Published' }).waitFor({ timeout: 10000 });
  check('publish: reaches Published against the Worker API', true);

  // --- 4. The published site serves and renders ---
  const sitePage = await browser.newPage();
  await sitePage.goto(`${BASE}/s/${SITE}/`, { waitUntil: 'domcontentloaded' });
  await sitePage.locator('archura-hero').waitFor({ state: 'visible', timeout: 10000 });
  const served = await sitePage.evaluate(() => ({
    heading: document.querySelector('archura-hero')?.shadowRoot?.querySelector('h1')?.textContent,
    firstCardProp: getComputedStyle(document.querySelector('archura-card')).getPropertyValue('--font-size').trim(),
  }));
  check(
    'site: published page renders with styles on /s/<name>/',
    served.heading === 'Welcome to Envelopment' && served.firstCardProp === '28px',
    JSON.stringify(served)
  );

  // --- 5. Live update: re-publish and watch the open site change, no reload ---
  await sitePage.evaluate(() => {
    window.__noReload = true;
  });
  await fontSize.fill('40');
  await fontSize.press('Enter');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await sitePage.waitForFunction(
    () => getComputedStyle(document.querySelector('archura-card')).getPropertyValue('--font-size').trim() === '40px',
    null,
    { timeout: 15000 }
  );
  const noReload = await sitePage.evaluate(() => window.__noReload === true);
  check('site: live update appears within the poll interval, without a reload', noReload);
  await sitePage.close();

  // --- 6. Write protection ---
  const security = await page.evaluate(async (site) => {
    const artifact = await (await fetch(`/api/artifacts/${site}/pages/Landing`)).json();
    const put = (headers) =>
      fetch(`/api/artifacts/${site}/pages/Landing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(artifact),
      }).then((r) => r.status);
    return {
      noToken: await put({}),
      badToken: await put({ Authorization: 'Bearer wrong' }),
      duplicateClaim: (await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site }),
      })).status,
      reservedClaim: (await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: 'api' }),
      })).status,
    };
  }, SITE);
  check(
    'security: publish requires the claim token (401), duplicate claim 409, reserved name 400',
    security.noToken === 401 && security.badToken === 401 && security.duplicateClaim === 409 && security.reservedClaim === 400,
    JSON.stringify(security)
  );

  // --- 7. Unpublished site shows the placeholder (and would live-update) ---
  const emptyPage = await browser.newPage();
  await emptyPage.goto(`${BASE}/s/never-published-xyz/`, { waitUntil: 'domcontentloaded' });
  check(
    'site: unpublished subdomain serves the waiting page',
    (await emptyPage.locator('#archura-root').innerText()).includes('Nothing published')
  );
  await emptyPage.close();

  // --- 8. Reopening the editor restores published state through the Worker ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  const restored = await frame
    .locator('archura-card')
    .first()
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--font-size').trim());
  check('editor: reload restores the published state from the Worker', restored === '40px', restored);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
