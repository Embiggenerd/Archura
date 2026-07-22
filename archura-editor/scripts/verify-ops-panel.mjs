// Browser test for the /ops/ panel. Stubs /api/ops/* via Playwright routing
// (no Worker/core needed) to prove the page boots and its access-gate, browse,
// and fork-redirect logic work.
// Usage: node scripts/verify-ops-panel.mjs (expects vite dev server on :5199)
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const results = [];
const check = (name, cond, detail = '') => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const ORG = 'aaaaaaaa-1111-2222-3333-444444444444';
const DESIGN = `dsn_${'a'.repeat(32)}`;
const FORK = `dsn_${'f'.repeat(32)}`;

const browser = await chromium.launch();

// Route /api/ops/* to a stub map keyed by "METHOD /rest" (path only, no query).
async function opsPage(routes) {
  const page = await browser.newPage();
  await page.route('**/api/ops/**', async (route) => {
    const url = new URL(route.request().url());
    const rest = url.pathname.replace(/^\/api\/ops\//, '');
    const entry = routes[`${route.request().method()} ${rest}`] ?? routes[rest];
    if (!entry) return route.fulfill({ status: 404, body: '{}' });
    await route.fulfill({
      status: entry.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(entry.body ?? {}),
    });
  });
  return page;
}

try {
  // --- 1. Non-staff → access denied ---
  const denied = await opsPage({ organizations: { status: 403, body: { error: 'forbidden' } } });
  await denied.goto(`${BASE}/ops/`, { waitUntil: 'domcontentloaded' });
  await denied.getByText('Not authorized').waitFor({ timeout: 8000 });
  check('access: non-staff sees "Not authorized"', true);
  await denied.close();

  // --- 2. Staff → org list → detail → fork redirect (core's response envelopes) ---
  const page = await opsPage({
    organizations: { body: { organizations: [{ id: ORG, name: 'Acme Plumbing', slug: 'acme', status: 'active' }], next_cursor: null } },
    [`organizations/${ORG}`]: { body: { id: ORG, name: 'Acme Plumbing', slug: 'acme', status: 'active', member_count: 2, design_count: 1, site_count: 1, billing: { free_trial_days: 2, free_design_limit: 3, free_site_limit: 1, free_no_expiry: false } } },
    [`organizations/${ORG}/designs`]: { body: { designs: [{ id: DESIGN, name: 'Main website', component_path: 'pages/Landing' }], next_cursor: null } },
    // The Worker (not core) shapes the fork response the page consumes.
    'POST forks': { status: 201, body: { fork_design_id: FORK, workspace_org_id: 'ws' } },
  });
  await page.goto(`${BASE}/ops/`, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Acme Plumbing' }).click();
  await page.getByText('Free-plan terms').waitFor({ timeout: 8000 });
  check('browse: org detail shows designs + free-plan panel', await page.getByText('Main website').isVisible());
  check('browse: read-only — no customer content edit control', (await page.getByRole('button', { name: /^Save terms$/ }).count()) === 1);

  // Fork redirects into the editor on the new fork.
  await page.getByRole('button', { name: 'Fork' }).click();
  await page.waitForURL((url) => url.searchParams.get('design') === FORK, { timeout: 8000 });
  check('fork: redirects into the editor on the forked design', page.url().includes(`design=${FORK}`));
  await page.close();

  // --- 3. Prod step-up: organizations 403 mfa_required → verify → list replays ---
  let verified = false;
  const mfaPage = await browser.newPage();
  await mfaPage.route('**/api/ops/**', async (route) => {
    const rest = new URL(route.request().url()).pathname.replace(/^\/api\/ops\//, '');
    const method = route.request().method();
    if (method === 'POST' && rest === 'mfa/verify') {
      verified = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ elevated_until: new Date(Date.now() + 9e5).toISOString() }) });
    }
    if (rest === 'organizations' && !verified) {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'mfa_required', message: 'Verify your two-factor code to continue.' } }) });
    }
    if (rest === 'organizations') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ organizations: [{ id: ORG, name: 'Acme Plumbing', slug: 'acme', status: 'active' }], next_cursor: null }) });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await mfaPage.goto(`${BASE}/ops/`, { waitUntil: 'domcontentloaded' });
  await mfaPage.getByText(/Verify it/).waitFor({ timeout: 8000 });
  check('mfa: step-up modal appears on mfa_required', true);
  await mfaPage.getByPlaceholder('123456').fill('123456');
  await mfaPage.getByRole('button', { name: 'Verify' }).click();
  await mfaPage.getByRole('button', { name: 'Acme Plumbing' }).waitFor({ timeout: 8000 });
  check('mfa: blocked view replays after successful verify', true);
  await mfaPage.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  await browser.close();
}
