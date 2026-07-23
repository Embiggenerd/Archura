// Browser test for the out-of-site-slots warning on the two site-creating
// surfaces (publish modal + claim screen). Stubs /api/me via Playwright
// routing. The funnel bar only exists in PROD builds, so this needs the
// BUILT app: npm run build && npx vite preview --port 5199, then
// node scripts/verify-capacity-warning.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const results = [];
const check = (name, cond) => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); };
const browser = await chromium.launch();

async function editPage(me) {
  const page = await browser.newPage();
  await page.route('**/api/me', (route) =>
    me
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(me) })
      : route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' })
  );
  await page.goto(`${BASE}/edit/`, { waitUntil: 'domcontentloaded' });
  return page;
}
const org = (slots) => ({ organizations: [{ id: 'o1', is_default: true, site_slots_remaining: slots }] });

try {
  // Slots exhausted → warning in the publish modal and the claim screen.
  const full = await editPage(org(0));
  await full.locator('.deploy-open').click();
  await full.locator('.capacity-warning').waitFor({ timeout: 8000 });
  check('publish modal warns when no slots remain', true);
  check('warning links to the account page', await full.locator('.capacity-warning a[href="/account/"]').isVisible());
  await full.locator('.overlay').first().click({ position: { x: 5, y: 5 } });
  await full.locator('.claim-open').click();
  await full.locator('.claim .capacity-warning').waitFor({ timeout: 8000 });
  check('claim screen warns when no slots remain', true);
  await full.close();

  // Slots available → silence.
  const roomy = await editPage(org(2));
  await roomy.locator('.deploy-open').click();
  await roomy.locator('input[name="site"]').waitFor({ timeout: 8000 });
  await roomy.waitForTimeout(600);
  check('no warning when slots remain', (await roomy.locator('.capacity-warning').count()) === 0);
  await roomy.close();

  // Anonymous (401) → silence.
  const anon = await editPage(null);
  await anon.locator('.deploy-open').click();
  await anon.locator('input[name="site"]').waitFor({ timeout: 8000 });
  await anon.waitForTimeout(600);
  check('no warning for anonymous visitors', (await anon.locator('.capacity-warning').count()) === 0);
  await anon.close();

  // Field absent (older core) → silence.
  const oldCore = await editPage({ organizations: [{ id: 'o1', is_default: true }] });
  await oldCore.locator('.deploy-open').click();
  await oldCore.locator('input[name="site"]').waitFor({ timeout: 8000 });
  await oldCore.waitForTimeout(600);
  check('no warning when the field is absent', (await oldCore.locator('.capacity-warning').count()) === 0);
  await oldCore.close();
} finally {
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
  await browser.close();
}
