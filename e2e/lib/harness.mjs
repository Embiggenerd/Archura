// Shared helpers for ./e2e runners (HTTP against the running stack only).
import { chromium } from 'playwright';

export const WORKER = process.env.E2E_WORKER ?? 'http://localhost:8787';
export const CORE = process.env.E2E_CORE ?? 'http://localhost:8080';

/** Vite often lands on 5173+ when the preferred port is busy — discover it. */
const VITE_CANDIDATES = [
  process.env.E2E_VITE,
  'http://localhost:5199',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
].filter(Boolean);

export const stamp = () => Date.now().toString(36);

export async function resolveVite() {
  for (const base of VITE_CANDIDATES) {
    const res = await probe(`${base}/edit/`);
    if (res && res.status < 500) return base.replace(/\/$/, '');
  }
  return null;
}

export function createChecks() {
  const results = [];
  const check = (name, cond, detail = '') => {
    results.push({ name, pass: !!cond, detail });
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
  };
  const finish = () => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  };
  return { results, check, finish };
}

/** Reachability probe. Milestone suites must call requireOk — never exit 0 on miss. */
export async function probe(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}

export async function requireOk(label, url, init, ok = (r) => r && r.status < 500) {
  const res = await probe(url, init);
  if (!ok(res)) {
    console.error(
      `FAIL — ${label} not ready (${url} → ${res?.status ?? 'unreachable'}). ` +
        `Start the stack (e.g. sh scripts/dev-up.sh) and re-run.`
    );
    process.exit(2);
  }
  return res;
}

export async function launchBrowser() {
  const headed = process.env.HEADED === '1' || process.env.HEADED === 'true';
  return chromium.launch({
    headless: !headed,
    slowMo: headed ? Number(process.env.SLOWMO ?? 100) : 0,
  });
}

export function trackPageErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('pageerror:', e.message);
  });
  return errors;
}

export function absoluteUrl(href, origin = WORKER) {
  if (!href) return null;
  return href.startsWith('http') ? href : `${origin.replace(/\/$/, '')}${href.startsWith('/') ? '' : '/'}${href}`;
}

/** Hard-fail unless Worker + funnel core can accept a registration. */
export async function requireFunnelStack() {
  const id = stamp();
  await requireOk('Worker', `${WORKER}/`, undefined, (r) => r && r.status < 500);
  await requireOk(
    'Funnel core (via Worker /api/register)',
    `${WORKER}/api/register`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `probe-${id}@e2e.test` }),
    },
    (r) => r && r.status === 201
  );
}

/** Read the confirm href for an email from the /dev-mail/ UI. */
export async function mailboxConfirmHref(page, email) {
  await page.goto(`${WORKER}/dev-mail/`, { waitUntil: 'domcontentloaded' });
  const row = page.locator('li', { hasText: email }).first();
  await row.waitFor({ timeout: 15000 });
  return row.locator('a[href*="token="]').first().getAttribute('href');
}

/** Dblclick-edit the first card title; returns the committed attribute value. */
export async function editFirstCardTitle(page, frame, marker) {
  await frame.locator('archura-card h3').first().dblclick();
  await page.keyboard.type(marker);
  await frame.locator('archura-hero').click({ position: { x: 10, y: 10 } });
  let title = '';
  for (let i = 0; i < 25; i++) {
    title = (await frame.locator('archura-card').first().getAttribute('title')) ?? '';
    if (title === marker) break;
    await page.waitForTimeout(200);
  }
  return title;
}
