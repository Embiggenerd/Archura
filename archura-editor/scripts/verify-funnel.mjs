// Deploy funnel + dashboard, end to end (the milestone gate for
// ../docs/PLAN_FUNNEL.md):
// - Flow 2 (build-first): anonymous edit → Deploy (subdomain + email) →
//   loader → magic link from the dev mailbox → confirm with preview + embed
//   code → the open loader tab flips live; dashboard shows the site.
// - Component build-first: anonymous component edit → Publish → confirm →
//   dashboard/embed code, with no hosted-page link or page visit required.
// - Flow 1 (register-first): register → dashboard → claim → publish the
//   Stripe component → embed snippet served and rendering cross-origin.
// - Negatives: cross-account writes, token reuse, unconfirmed drafts.
// Usage: node scripts/verify-funnel.mjs
// (expects vite :5199, `wrangler dev --port 8787`, and the local core with
//  funnel endpoints — `sh scripts/dev-up.sh` from the repo root; SKIPs
//  cleanly otherwise)
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const WORKER = 'http://localhost:8787';
const EMBED_PORT = 5299;
const STAMP = Date.now().toString(36);
const siteA = `funnel-a-${STAMP}`;
const siteB = `funnel-b-${STAMP}`;
const componentSite = `funnel-component-${STAMP}`;
const emailA = `a-${STAMP}@funnel.test`;
const emailB = `b-${STAMP}@funnel.test`;
const componentEmail = `component-${STAMP}@funnel.test`;

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

// SKIP unless the Worker can reach a funnel-capable core. Retry a few times:
// a fresh wrangler dev serves 5xx while its first requests warm up.
let probeStatus = 'unreachable';
for (let attempt = 0; attempt < 4; attempt++) {
  const probe = await fetch(`${WORKER}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `probe-${STAMP}-${attempt}@funnel.test` }),
  }).catch(() => null);
  probeStatus = probe?.status ?? 'unreachable';
  if (probeStatus === 201) break;
  await new Promise((r) => setTimeout(r, 2500));
}
if (probeStatus !== 201) {
  console.log(`SKIP — funnel needs wrangler dev + local core with funnel endpoints (probe: ${probeStatus})`);
  process.exit(0);
}

const mailboxLink = async (email) => {
  const res = await fetch(`${WORKER}/api/dev/mailbox`);
  if (!res.ok) return null;
  const { confirmations = [] } = await res.json();
  return confirmations.find((c) => c.email === email)?.confirm_url ?? null;
};

const browser = await chromium.launch();
const contextA = await browser.newContext();
const contextB = await browser.newContext();
const contextC = await browser.newContext();

const embedServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${EMBED_PORT}`);
  const source = url.searchParams.get('source') ?? '';
  const tag = url.searchParams.get('tag') ?? '';
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><body>
    <script type="module" src="${source}"></script>
    <${tag}></${tag}>
  </body></html>`);
});

let pageEmbedUrl = '';

try {
  // ============ Flow 2: build-first ============
  const pageA = await contextA.newPage();
  pageA.on('pageerror', (e) => console.log('pageerror:', e.message));
  await pageA.goto(`${WORKER}/edit/`, { waitUntil: 'domcontentloaded' });
  const frame = pageA.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });

  // Inline-edit the heading and go STRAIGHT to Deploy (no click elsewhere,
  // no Enter) — the uncommitted-edit path that once lost the text
  await frame.locator('archura-hero h1').dblclick();
  await pageA.keyboard.type('Welcome to hihi');

  await pageA.locator('.deploy-open').click();
  check(
    'ui: a page-sized artifact uses the same component publishing flow',
    (await pageA.locator('.modal h2').textContent()) === 'Publish your component'
  );
  // Modern Chrome compiles pattern attributes with the v flag; an unescaped
  // hyphen in a class is a SyntaxError there (regressed once via template-
  // literal escaping eating the backslash)
  const patternOk = await pageA.locator('.modal input[name="site"]').evaluate((el) => {
    try {
      new RegExp(el.getAttribute('pattern'), 'v');
      return true;
    } catch {
      return false;
    }
  });
  check('ui: subdomain pattern attribute compiles under the v flag', patternOk);
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

  // Keep a loader tab open — it must flip to the live site by itself
  const sitePageA = await contextA.newPage();
  await sitePageA.goto(`${WORKER}/s/${siteA}/`, { waitUntil: 'domcontentloaded' });

  const linkA = await mailboxLink(emailA);
  check('mailbox: dev mailbox lists the confirmation link', !!linkA);
  await pageA.goto(linkA, { waitUntil: 'domcontentloaded' });
  check(
    'confirm: magic link redirects straight to the published site',
    new URL(pageA.url()).pathname === `/s/${siteA}/`,
    pageA.url()
  );
  await pageA.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  check('confirm: the redirected page renders the published page', true);

  // The open loader tab promotes-on-poll and reloads into the live site
  await sitePageA.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  check('promote: the open loader tab flipped to the live site on its own', true);

  const servedHeading = sitePageA.locator('archura-hero h1');
  const headingText = await servedHeading.evaluate((el) => el.textContent?.trim());
  await servedHeading.dblclick();
  const headingEditable = await servedHeading.evaluate((el) => el.isContentEditable);
  check(
    'content: the inline text edit made straight before Deploy is live, and NOT editable on the served page',
    headingText === 'Welcome to hihi' && headingEditable === false,
    JSON.stringify({ headingText, headingEditable })
  );

  await pageA.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });
  await pageA.locator('.card').first().waitFor({ timeout: 15000 });
  await pageA.locator('.card').filter({ hasText: siteA }).waitFor({ timeout: 15000 });
  const dashA = await pageA.textContent('body');
  check(
    "dashboard: flow 2's account is signed in, shows the deployed site and its embed code",
    dashA.includes(emailA) && dashA.includes(siteA) && dashA.includes('Get embed code'),
    dashA.slice(0, 200)
  );
  const listA = await pageA.evaluate(async (site) => {
    const response = await fetch(`/api/sites/${site}/list`);
    return response.ok ? response.json() : null;
  }, siteA);
  pageEmbedUrl = `${listA?.embedBase}/Landing.js`;
  const pageEmbedResponse = await fetch(pageEmbedUrl);
  check(
    'page embed: published page has a stable organization + site identity URL',
    listA?.publishableKey?.startsWith('pk_test_') && listA?.siteId?.startsWith('site_') && pageEmbedResponse.status === 200,
    JSON.stringify(listA)
  );

  // ============ Component build-first ============
  const pageC = await contextC.newPage();
  pageC.on('pageerror', (e) => console.log('pageerror:', e.message));
  await pageC.goto(`${WORKER}/`, { waitUntil: 'domcontentloaded' });
  await pageC.locator('[data-mode="component"]').click();
  await pageC.frameLocator('iframe.gjs-frame')
    .locator('archura-stripe-payment')
    .waitFor({ state: 'visible', timeout: 20000 });
  await pageC.locator('[data-deploy]').click();
  const componentModalText = await pageC.locator('.modal').textContent();
  check(
    'smaller component: uses the same component publishing flow',
    componentModalText.includes('Publish your component'),
    componentModalText
  );
  await pageC.locator('.modal input[name="site"]').fill(componentSite);
  await pageC.locator('.modal input[name="email"]').fill(componentEmail);
  await pageC.locator('.modal button[type="submit"]').click();
  await pageC.locator('.modal', { hasText: 'Check your email' }).waitFor({ timeout: 15000 });

  const componentLink = await mailboxLink(componentEmail);
  check('component deploy: dev mailbox lists the confirmation link', !!componentLink);
  await pageC.goto(componentLink, { waitUntil: 'domcontentloaded' });
  check(
    'smaller component: confirmation redirects straight to the hosted component',
    new URL(pageC.url()).pathname === `/s/${componentSite}/`,
    pageC.url()
  );
  await pageC.locator('archura-stripe-payment').waitFor({ state: 'visible', timeout: 20000 });
  check('smaller component: the redirected page renders the hosted component', true);

  await pageC.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });
  const componentCard = pageC.locator('.card').filter({ hasText: componentSite });
  await componentCard.waitFor({ timeout: 15000 });
  const componentCardText = await componentCard.textContent();
  check(
    'component dashboard: offers component editing, hosted preview, and embed code',
    componentCardText.includes('Edit') &&
      componentCardText.includes('Get embed code') &&
      componentCardText.includes('Open site'),
    componentCardText
  );
  const componentPreview = await contextC.newPage();
  await componentPreview.goto(`${WORKER}/s/${componentSite}/`, { waitUntil: 'domcontentloaded' });
  await componentPreview.locator('archura-stripe-payment').waitFor({ state: 'visible', timeout: 15000 });
  check('component preview: the hosted page renders the selected component', true);
  await componentPreview.close();
  const componentList = await pageC.evaluate(async (site) => {
    const response = await fetch(`/api/sites/${site}/list`);
    return response.ok ? response.json() : null;
  }, componentSite);
  const componentEmbed = await fetch(`${componentList?.embedBase}/StripePayment.js`);
  check(
    'component confirm: publishes the stable embed immediately without visiting a hosted page',
    componentList?.componentPath?.join('/') === 'payments/StripePayment' &&
      componentEmbed.status === 200,
    JSON.stringify({ componentList, status: componentEmbed.status })
  );

  // ============ Flow 1: register-first ============
  const pageB = await contextB.newPage();
  pageB.on('pageerror', (e) => console.log('pageerror:', e.message));
  await pageB.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });
  await pageB.locator('input[type="email"]').fill(emailB);
  await pageB.locator('form button').click();
  await pageB.locator('.card', { hasText: 'Check your email' }).waitFor({ timeout: 15000 });
  const linkB = await mailboxLink(emailB);
  check('register: email-only registration produces a magic link', !!linkB);
  await pageB.goto(linkB, { waitUntil: 'domcontentloaded' });
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
    'publish: post-publish panel shows a client-specific embed snippet',
    panelText.includes('Embed snippet') && panelText.includes('amount='),
    panelText
  );

  const listB = await pageB.evaluate(async (site) => {
    const response = await fetch(`/api/sites/${site}/list`);
    return response.ok ? response.json() : null;
  }, siteB);
  const stripeEmbedUrl = `${listB?.embedBase}/StripePayment.js`;

  const embedRes = await fetch(stripeEmbedUrl);
  check(
    'embed: stable organization + site component URL serves as JS',
    embedRes.status === 200 && (embedRes.headers.get('content-type') ?? '').includes('javascript')
  );

  await new Promise((resolve) => embedServer.listen(EMBED_PORT, resolve));
  const embedPage = await contextB.newPage();
  await embedPage.goto(`http://localhost:${EMBED_PORT}/?source=${encodeURIComponent(stripeEmbedUrl)}&tag=archura-stripe-payment`, { waitUntil: 'domcontentloaded' });
  await embedPage.locator('archura-stripe-payment .form').waitFor({ state: 'visible', timeout: 15000 });
  check('embed: snippet renders the component on a foreign origin', true);
  await embedPage.close();

  const embeddedPage = await contextB.newPage();
  await embeddedPage.goto(`http://localhost:${EMBED_PORT}/?source=${encodeURIComponent(pageEmbedUrl)}&tag=archura-landing`, { waitUntil: 'domcontentloaded' });
  await embeddedPage.locator('archura-landing archura-hero').waitFor({ state: 'visible', timeout: 15000 });
  check('page embed: page-sized snippet renders the saved page on a foreign origin', true);
  await embeddedPage.close();

  // ============ Negatives ============
  const crossWrite = await pageB.evaluate(async (target) => {
    const res = await fetch(`/api/artifacts/${target}/pages/Landing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return res.status;
  }, siteA);
  check("isolation: account B's session cannot write to account A's site", crossWrite === 401, `status ${crossWrite}`);

  // Link reuse: WITH a session it's the user's way back — straight to their
  // account. WITHOUT one (new device) it explains how to sign in again.
  await pageA.goto(linkA, { waitUntil: 'domcontentloaded' });
  check(
    'security: a used link with a live session redirects to the account, not an error',
    new URL(pageA.url()).pathname === '/account/',
    pageA.url()
  );
  const freshContext = await browser.newContext();
  const freshPage = await freshContext.newPage();
  await freshPage.goto(linkA, { waitUntil: 'domcontentloaded' });
  const freshBody = await freshPage.textContent('body');
  check(
    'security: a used link without a session cannot re-authenticate, but points at the account',
    freshBody.toLowerCase().includes('already used or expired') &&
      freshBody.toLowerCase().includes('account') &&
      (await freshPage.locator('a[href="/account/"]').count()) === 1,
    freshBody.slice(0, 150)
  );
  await freshContext.close();

  // Additional deploys for the same account are intentionally allowed and
  // bind to its default organization.
  const additionalSite = `funnel-additional-${STAMP}`;
  const dupRes = await fetch(`${WORKER}/api/deploys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      site: additionalSite,
      email: emailA,
      artifact: {
        schemaVersion: 1, id: 'dup', type: 'component-instance',
        content: {}, snapshot: { html: '', css: '' },
        config: { componentPath: ['pages', 'Landing'] },
        meta: { createdAt: 'x', updatedAt: 'x' },
      },
      embeds: {},
    }),
  });
  check('rule: the same account can deploy another site', dupRes.status === 201, `status ${dupRes.status}`);

  const loaderC = await (await fetch(`${WORKER}/s/${additionalSite}/`)).text();
  check(
    'anti-abuse: an unconfirmed deploy never serves content',
    dupRes.status === 201 && loaderC.includes('is deploying')
  );

  // --- Sign out ---
  await pageB.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });
  await pageB.locator('#signout').waitFor({ state: 'visible', timeout: 15000 });
  await pageB.locator('#signout').click();
  await pageB.waitForURL(`${WORKER}/account/`);
  await pageB.locator('#register', { hasText: 'Send sign-in link' }).waitFor({ timeout: 15000 });
  const meAfterLogout = await pageB.evaluate(async () => (await fetch('/api/me')).status);
  check(
    'logout: sign out clears the session — account shows sign-in, /api/me is 401',
    meAfterLogout === 401,
    `status ${meAfterLogout}`
  );
} finally {
  embedServer.close();
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
