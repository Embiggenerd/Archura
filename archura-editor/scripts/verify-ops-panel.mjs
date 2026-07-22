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
const ACCOUNT = 'bbbbbbbb-1111-2222-3333-444444444444';
const DESIGN = `dsn_${'a'.repeat(32)}`;
const FORK = `dsn_${'f'.repeat(32)}`;
const ALIAS_EMAIL = 'test22+igor.atakhanov@gmail.com';

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

  // --- 1b. Environment badge: staging is its own state, not "Production" ---
  const badgePage = await opsPage({
    context: { body: { env: 'staging' } },
    organizations: { body: { organizations: [], next_cursor: null } },
  });
  await badgePage.goto(`${BASE}/ops/`, { waitUntil: 'domcontentloaded' });
  await badgePage.locator('#ops-env', { hasText: 'Staging' }).waitFor({ timeout: 8000 });
  check('badge: core env "staging" renders the Staging badge', true);
  await badgePage.close();

  // --- 2. Staff → org list → detail → fork redirect (core's response envelopes) ---
  const orgRoutes = {
    organizations: { body: { organizations: [{ id: ORG, name: 'Acme Plumbing', slug: 'acme', status: 'active' }], next_cursor: null } },
    [`organizations/${ORG}`]: { body: { id: ORG, name: 'Acme Plumbing', slug: 'acme', status: 'active', member_count: 2, design_count: 1, site_count: 1, billing: { free_trial_days: 2, free_design_limit: 3, free_site_limit: 1, free_no_expiry: false } } },
    [`organizations/${ORG}/designs`]: { body: { designs: [{ id: DESIGN, name: 'Main website', component_path: 'pages/Landing' }], next_cursor: null } },
    // The Worker (not core) shapes the fork response the page consumes.
    'POST forks': { status: 201, body: { fork_design_id: FORK, workspace_org_id: 'ws' } },
  };
  const page = await opsPage(orgRoutes);
  await page.goto(`${BASE}/ops/`, { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Acme Plumbing' }).click();
  await page.getByText('Free-plan terms').waitFor({ timeout: 8000 });
  check('routing: org click pushes /ops/orgs/<id>', new URL(page.url()).pathname === `/ops/orgs/${ORG}`);
  check('browse: org detail shows designs + free-plan panel', await page.getByText('Main website').isVisible());
  check('browse: read-only — no customer content edit control', (await page.getByRole('button', { name: /^Save terms$/ }).count()) === 1);
  check('delete: slug displayed in the danger zone', await page.locator('.card', { hasText: 'Danger zone' }).getByText('acme', { exact: true }).isVisible());

  // Back button returns to the list without leaving the console.
  await page.goBack();
  await page.getByText('Browse any organization').waitFor({ timeout: 8000 });
  check('routing: back returns to the organizations list', new URL(page.url()).pathname === '/ops/');
  await page.goForward();
  await page.getByText('Danger zone').waitFor({ timeout: 8000 });

  // Fork redirects into the editor on the new fork.
  await page.getByRole('button', { name: 'Fork' }).click();
  await page.waitForURL((url) => url.searchParams.get('design') === FORK, { timeout: 8000 });
  check('fork: redirects into the editor on the forked design', page.url().includes(`design=${FORK}`));
  await page.close();

  // --- 3. Org delete: typed-slug confirmation gates the destructive call ---
  const delPage = await opsPage({
    ...orgRoutes,
    [`DELETE organizations/${ORG}`]: { body: { released_sites: [], purge: 'complete' } },
  });
  await delPage.goto(`${BASE}/ops/`, { waitUntil: 'domcontentloaded' });
  await delPage.getByRole('button', { name: 'Acme Plumbing' }).click();
  await delPage.getByRole('button', { name: 'Delete organization' }).click();
  const orgConfirm = delPage.locator('[data-delete-modal] [data-confirm]');
  check('delete: confirm disabled before the slug is typed', await orgConfirm.isDisabled());
  await delPage.locator('[data-delete-modal] [data-phrase]').fill('acme');
  check('delete: typing the exact slug enables confirm', await orgConfirm.isEnabled());
  await orgConfirm.click();
  await delPage.getByText('Deleted acme').waitFor({ timeout: 8000 });
  check('delete: success navigates back to the list with a notice', new URL(delPage.url()).pathname === '/ops/');
  await delPage.close();

  // --- 4. Accounts tab: list, preview-driven delete with typed email ---
  const acctPage = await opsPage({
    ...orgRoutes,
    accounts: { body: { accounts: [
      { id: ACCOUNT, email: ALIAS_EMAIL, staff_role: null, created_at: '2026-07-01T00:00:00Z', membership_count: 1 },
      { id: 'staff-1', email: 'igor@archura.ai', staff_role: 'platform_owner', created_at: '2026-01-01T00:00:00Z', membership_count: 2 },
    ], next_cursor: null } },
    [`accounts/${ACCOUNT}`]: { body: { id: ACCOUNT, email: ALIAS_EMAIL, memberships: [
      { organization_id: ORG, slug: 'acme', role: 'owner', member_count: 1, sole_member: true, last_owner: false, sites: ['acme-site'] },
    ] } },
    [`DELETE accounts/${ACCOUNT}`]: { body: { deleted_organization_ids: [ORG], released_sites: ['acme-site'], purge: 'complete' } },
  });
  await acctPage.goto(`${BASE}/ops/`, { waitUntil: 'domcontentloaded' });
  await acctPage.getByRole('link', { name: 'Accounts' }).click();
  await acctPage.getByText(ALIAS_EMAIL).waitFor({ timeout: 8000 });
  check('accounts: tab routes to /ops/accounts', new URL(acctPage.url()).pathname === '/ops/accounts');
  check('accounts: staff account shows no delete control', (await acctPage.getByRole('button', { name: 'Delete' }).count()) === 1);
  await acctPage.getByRole('button', { name: 'Delete' }).click();
  await acctPage.getByText('sole member').waitFor({ timeout: 8000 });
  check('accounts: preview names the cascading org and its site', await acctPage.getByText('acme-site').isVisible());
  const acctConfirm = acctPage.locator('[data-delete-modal] [data-confirm]');
  check('accounts: confirm disabled before the email is typed', await acctConfirm.isDisabled());
  await acctPage.locator('[data-delete-modal] [data-phrase]').fill(ALIAS_EMAIL);
  await acctConfirm.click();
  await acctPage.getByText(`Deleted ${ALIAS_EMAIL}`).waitFor({ timeout: 8000 });
  check('accounts: plus-alias email works as the typed confirmation', true);
  await acctPage.close();

  // --- 5. Register modal accepts a plus-alias email (Igor's test mechanism) ---
  const regPage = await browser.newPage();
  await regPage.route('**/api/register', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );
  await regPage.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await regPage.locator('[data-register]').first().click();
  await regPage.locator('input[name="email"]').fill(ALIAS_EMAIL);
  await regPage.getByRole('button', { name: 'Send link' }).click();
  await regPage.getByText('Check your email').waitFor({ timeout: 8000 });
  check('register: plus-alias email accepted end-to-end', await regPage.getByText(ALIAS_EMAIL).isVisible());
  await regPage.close();

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
} finally {
  await browser.close();
}
