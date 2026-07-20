// Build-first + register-first funnel.
// Expects Worker :8787 + funnel-capable core (scripts/dev-up.sh). Hard-fails if unavailable.
// HEADED=1 for a visible browser; SLOWMO=ms when headed.
import { createServer } from 'node:http';
import {
  WORKER,
  stamp,
  createChecks,
  requireOk,
  launchBrowser,
  trackPageErrors,
} from './lib/harness.mjs';

const STAMP = stamp();
const siteA = `e2e-a-${STAMP}`;
const siteB = `e2e-b-${STAMP}`;
const emailA = `a-${STAMP}@e2e.test`;
const emailB = `b-${STAMP}@e2e.test`;
const MARKER = `E2E Marker ${STAMP}`;
const EMBED_PORT = 5399;

const { check, finish } = createChecks();

await requireOk('Worker', `${WORKER}/`, undefined, (r) => r && r.status < 500);
await requireOk(
  'Funnel core (via Worker /api/register)',
  `${WORKER}/api/register`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `probe-${STAMP}@e2e.test` }),
  },
  (r) => r && r.status === 201
);

const browser = await launchBrowser();
const contextA = await browser.newContext();
const contextB = await browser.newContext();

const embedServer = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body>
    <script type="module" src="${WORKER}/s/${siteB}/embed/StripePayment.js"></script>
    <archura-stripe-payment></archura-stripe-payment>
  </body></html>`);
});

try {
  // ============ Flow 2: build-first ============
  const pageA = await contextA.newPage();
  trackPageErrors(pageA);
  await pageA.goto(`${WORKER}/edit/`, { waitUntil: 'domcontentloaded' });
  const frame = pageA.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });

  // Distinctive edit — “same page you deployed” claim
  await frame.locator('archura-card h3').first().dblclick();
  await pageA.keyboard.type(MARKER);
  await frame.locator('archura-hero').click({ position: { x: 10, y: 10 } });
  let titleAttr = '';
  for (let i = 0; i < 25; i++) {
    titleAttr = (await frame.locator('archura-card').first().getAttribute('title')) ?? '';
    if (titleAttr === MARKER) break;
    await pageA.waitForTimeout(200);
  }
  check('editor: distinctive title commits before deploy', titleAttr === MARKER, titleAttr);

  // Bad email — must not advance to “Check your email”
  await pageA.locator('.deploy-open').click();
  const modal = pageA.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[name="site"]').fill(siteA);
  await modal.locator('input[name="email"]').fill('not-an-email');
  await modal.locator('button[type="submit"]').click();
  await pageA.waitForTimeout(500);
  const stuckOnBadEmail = await modal.evaluate((el) => {
    const email = el.querySelector('input[name="email"]');
    const advanced = /check your email/i.test(el.textContent ?? '');
    return !advanced && email && !email.checkValidity();
  });
  check('deploy: bad email is rejected (HTML validity / no advance)', stuckOnBadEmail);
  await pageA.locator('.overlay').click({ position: { x: 4, y: 4 } }).catch(() => {});
  // Re-open clean modal if overlay click closed it incompletely
  if (!(await pageA.locator('.deploy-open').isVisible().catch(() => false))) {
    // still in overlay — force remove
    await pageA.evaluate(() => document.querySelector('.overlay')?.remove());
  }

  await pageA.locator('.deploy-open').click();
  await pageA.locator('.modal input[name="site"]').fill(siteA);
  await pageA.locator('.modal input[name="email"]').fill(emailA);
  await pageA.locator('.modal button[type="submit"]').click();
  await pageA.locator('.modal', { hasText: 'Check your email' }).waitFor({ timeout: 15000 });
  check('deploy: anonymous deploy accepted, email capture shown', true);

  const loaderHtml = await (await fetch(`${WORKER}/s/${siteA}/`)).text();
  const draftArtifact = await fetch(`${WORKER}/s/${siteA}/artifact.json`);
  check(
    'drafted: subdomain serves the loader, nothing is published',
    loaderHtml.includes('is deploying') && draftArtifact.status === 404,
    `artifact.json ${draftArtifact.status}`
  );

  const sitePageA = await contextA.newPage();
  trackPageErrors(sitePageA);
  await sitePageA.goto(`${WORKER}/s/${siteA}/`, { waitUntil: 'domcontentloaded' });

  // Confirm via /dev-mail/ UI (not the mailbox API shortcut)
  await pageA.goto(`${WORKER}/dev-mail/`, { waitUntil: 'domcontentloaded' });
  const rowA = pageA.locator('li', { hasText: emailA }).first();
  await rowA.waitFor({ timeout: 10000 });
  const confirmHref = await rowA.locator('a[href*="token="]').first().getAttribute('href');
  check('mailbox UI: /dev-mail/ lists a confirm link for the deploy email', !!confirmHref, emailA);
  await pageA.goto(confirmHref.startsWith('http') ? confirmHref : `${WORKER}${confirmHref}`, {
    waitUntil: 'domcontentloaded',
  });
  check(
    'confirm: magic link lands on the confirmed page',
    (await pageA.textContent('body')).includes('Email confirmed')
  );

  await sitePageA.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  check('promote: the open loader tab flipped to the live site on its own', true);

  const liveTitle = await sitePageA.locator('archura-card').first().getAttribute('title');
  check(
    'promote: live site shows the distinctive title edited before deploy',
    liveTitle === MARKER,
    liveTitle ?? '(null)'
  );

  await pageA.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });
  await pageA.locator('.card').first().waitFor({ timeout: 15000 });
  const dashA = await pageA.textContent('body');
  check(
    "dashboard: flow 2's account is signed in and shows the deployed site",
    dashA.includes(emailA) && dashA.includes(siteA),
    dashA.slice(0, 200)
  );

  // Token reuse
  await pageA.goto(confirmHref.startsWith('http') ? confirmHref : `${WORKER}${confirmHref}`, {
    waitUntil: 'domcontentloaded',
  });
  check(
    'security: a confirmation link cannot be reused',
    (await pageA.textContent('body')).includes('invalid or expired')
  );

  // ============ Flow 1: register-first ============
  const pageB = await contextB.newPage();
  trackPageErrors(pageB);
  await pageB.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });
  await pageB.locator('input[type="email"]').fill(emailB);
  await pageB.locator('form button').click();
  await pageB.locator('.card', { hasText: 'Check your email' }).waitFor({ timeout: 15000 });

  await pageB.goto(`${WORKER}/dev-mail/`, { waitUntil: 'domcontentloaded' });
  const rowB = pageB.locator('li', { hasText: emailB }).first();
  await rowB.waitFor({ timeout: 10000 });
  const linkB = await rowB.locator('a[href*="token="]').first().getAttribute('href');
  check('register: /dev-mail/ shows the register-first magic link', !!linkB);
  await pageB.goto(linkB.startsWith('http') ? linkB : `${WORKER}${linkB}`, {
    waitUntil: 'domcontentloaded',
  });
  await pageB.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });

  await pageB.locator('input[name="site"]').fill(siteB);
  await pageB.locator('.card', { hasText: 'Claim a new site' }).locator('button').click();
  await pageB.waitForLoadState('domcontentloaded');
  await pageB.locator('.card h2', { hasText: siteB }).waitFor({ timeout: 15000 });
  check('claim: dashboard claim binds the site to the account', true);

  await pageB.goto(`${WORKER}/edit/?site=${siteB}&component=payments/StripePayment`, {
    waitUntil: 'domcontentloaded',
  });
  const frameB = pageB.frameLocator('iframe.gjs-frame');
  await frameB.locator('archura-stripe-payment').waitFor({ state: 'visible', timeout: 20000 });
  await pageB.getByRole('button', { name: 'Publish', exact: true }).click();
  await pageB.locator('.publish-panel', { hasText: 'Published' }).waitFor({ timeout: 15000 });
  const panelText = await pageB.locator('.publish-panel').textContent();
  check(
    'publish: post-publish panel shows the live link and embed snippet',
    panelText.includes('Embed snippet')
  );

  const embedRes = await fetch(`${WORKER}/s/${siteB}/embed/StripePayment.js`);
  check(
    'embed: published component module serves as JS',
    embedRes.status === 200 && (embedRes.headers.get('content-type') ?? '').includes('javascript')
  );

  await new Promise((resolve) => embedServer.listen(EMBED_PORT, resolve));
  const embedPage = await contextB.newPage();
  await embedPage.goto(`http://localhost:${EMBED_PORT}/`, { waitUntil: 'domcontentloaded' });
  await embedPage.locator('archura-stripe-payment .form').waitFor({ state: 'visible', timeout: 15000 });
  check('embed: snippet renders the component on a foreign origin', true);
  await embedPage.close();

  const crossWrite = await pageB.evaluate(async (target) => {
    const res = await fetch(`/api/artifacts/${target}/pages/Landing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return res.status;
  }, siteA);
  check(
    "isolation: account B's session cannot write to account A's site",
    crossWrite === 401 || crossWrite === 403,
    `status ${crossWrite}`
  );

  // Unconfirmed deploy never serves content
  const siteC = `e2e-c-${STAMP}`;
  const deployC = await fetch(`${WORKER}/api/deploys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site: siteC,
      email: `c-${STAMP}@e2e.test`,
      artifact: {
        schemaVersion: 1,
        id: 'c',
        type: 'component-instance',
        content: {},
        snapshot: { html: '', css: '' },
        config: { componentPath: ['pages', 'Landing'] },
        meta: { createdAt: 'x', updatedAt: 'x' },
      },
      embeds: {},
    }),
  });
  const loaderC = await (await fetch(`${WORKER}/s/${siteC}/`)).text();
  check(
    'anti-abuse: an unconfirmed deploy never serves content',
    deployC.status === 201 && loaderC.includes('is deploying')
  );
} finally {
  embedServer.close();
  await browser.close();
}

finish();
