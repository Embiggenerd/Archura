// Pathways from ./docs/USER_STORIES.md — Client Registration.
// Expects Worker :8787 + funnel-capable core (scripts/dev-up.sh).
// HEADED=1 for a visible browser.
import {
  WORKER,
  stamp,
  createChecks,
  requireFunnelStack,
  launchBrowser,
  trackPageErrors,
  absoluteUrl,
  mailboxConfirmHref,
  editFirstCardTitle,
} from './lib/harness.mjs';

const STAMP = stamp();
const { check, finish } = createChecks();

await requireFunnelStack();

const browser = await launchBrowser();

try {
  // ─────────────────────────────────────────────────────────────
  // Through first deployment
  // ─────────────────────────────────────────────────────────────
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  trackPageErrors(page);

  const site = `story-${STAMP}`;
  const email = `story-${STAMP}@e2e.test`;
  const marker = `Story Deploy ${STAMP}`;

  // Index hosts the editor inline — no redirect to /edit/
  await page.goto(`${WORKER}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-editor-mount] archura-editor').waitFor({ timeout: 15000 });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  check(
    'first-deploy: index hosts the inline editor with a canvas',
    new URL(page.url()).pathname === '/',
    page.url()
  );

  const committed = await editFirstCardTitle(page, frame, marker);
  check('first-deploy: user can edit the page before deploy', committed === marker, committed);

  // Invalid email → message / no advance
  await page.locator('[data-deploy]').click();
  let modal = page.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[name="site"]').fill(site);
  await modal.locator('input[name="email"]').fill('not-an-email');
  await modal.locator('button[type="submit"]').click();
  await page.waitForTimeout(400);
  const badEmail = await modal.evaluate((el) => {
    const input = el.querySelector('input[name="email"]');
    const advanced = /check your email|inbox/i.test(el.textContent ?? '');
    return {
      advanced,
      invalid: input ? !input.checkValidity() : false,
      error: (el.querySelector('.error')?.textContent ?? '').trim(),
    };
  });
  check(
    'first-deploy: invalid email is blocked with a message (validity or error)',
    !badEmail.advanced && (badEmail.invalid || badEmail.error.length > 0),
    JSON.stringify(badEmail)
  );

  // Happy path deploy
  await modal.locator('input[name="email"]').fill(email);
  await modal.locator('button[type="submit"]').click();
  await page.locator('.modal', { hasText: /check your email|inbox/i }).waitFor({ timeout: 15000 });
  const hasDevMailLink = await page.locator('.modal a[href*="dev-mail"]').count();
  check('first-deploy: after deploy, user is told to check inbox (dev-mail link locally)', hasDevMailLink > 0);

  // Dev mailbox → confirm link (stand-in for the email). A second tab reads the
  // mailbox so the original tab stays parked on the check-email state.
  const confirmTab = await ctx.newPage();
  trackPageErrors(confirmTab);
  const confirmHref = await mailboxConfirmHref(confirmTab, email);
  check('first-deploy: inbox (dev-mail) has the confirmation link', !!confirmHref, email);

  // Focus alone must not authenticate: before confirming, refocusing the
  // waiting tab leaves it waiting. Headless Chromium emulates a permanently
  // focused page and never delivers native focus/visibility events on
  // bringToFront, so the user's return is simulated by dispatching the same
  // focus event the browser would fire — the product listener, /api/me round
  // trip, and redirect logic all run for real.
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(1500);
  const stillWaiting = await page.evaluate(() => ({
    path: location.pathname,
    waiting: /check your email/i.test(document.querySelector('.modal')?.textContent ?? ''),
  }));
  check(
    'two-tab: focus without confirmation does not redirect',
    stillWaiting.path === '/' && stillWaiting.waiting,
    JSON.stringify(stillWaiting)
  );

  // Confirm in the second tab: deployment confirmations land on the published
  // site itself.
  await confirmTab.goto(absoluteUrl(confirmHref), { waitUntil: 'domcontentloaded' });
  await confirmTab.waitForURL(new RegExp(`/s/${site}/?`), { timeout: 15000 });
  await confirmTab.locator('archura-hero').waitFor({ state: 'visible', timeout: 25000 });
  const liveTitle = await confirmTab.locator('archura-card').first().getAttribute('title');
  check(
    'first-deploy: confirm link opens the published site matching what the user edited',
    liveTitle === marker,
    liveTitle ?? '(null)'
  );

  // The original tab detects the confirmed session on refocus and moves to the
  // dashboard (same simulated-refocus caveat as above).
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForURL(/\/dashboard\/?/, { timeout: 15000 });
  await page.locator('#who').waitFor({ state: 'attached', timeout: 15000 });
  await page.waitForFunction(
    (expected) => (document.getElementById('who')?.textContent ?? '') === expected,
    email,
    { timeout: 15000 }
  ).catch(() => {});
  const deployWho = ((await page.locator('#who').textContent()) ?? '').trim();
  check('two-tab: waiting tab redirects to the signed-in dashboard', deployWho === email, deployWho || '(empty)');

  // Signed-in visits to the front page keep landing on the dashboard.
  await page.goto(`${WORKER}/`, { waitUntil: 'domcontentloaded' });
  check(
    'first-deploy: signed-in / redirects to the dashboard',
    /\/dashboard\/?/.test(new URL(page.url()).pathname),
    page.url()
  );
  await ctx.close();

  // Taken subdomain → message (fresh anonymous visitor on the front page)
  const anonCtx = await browser.newContext();
  const anon = await anonCtx.newPage();
  trackPageErrors(anon);
  await anon.goto(`${WORKER}/`, { waitUntil: 'domcontentloaded' });
  await anon.frameLocator('iframe.gjs-frame').locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await anon.locator('[data-deploy]').click();
  modal = anon.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[name="site"]').fill(site); // already used
  await modal.locator('input[name="email"]').fill(`other-${STAMP}@e2e.test`);
  await modal.locator('button[type="submit"]').click();
  await anon.waitForTimeout(800);
  const taken = await modal.evaluate((el) => {
    const advanced = /check your email|inbox/i.test(el.textContent ?? '');
    const error = (el.querySelector('.error')?.textContent ?? '').trim();
    return { advanced, error };
  });
  check(
    'first-deploy: used subdomain shows a message and does not advance',
    !taken.advanced && /taken|already|used/i.test(taken.error),
    taken.error || '(no error)'
  );
  await anon.evaluate(() => document.querySelector('.overlay')?.remove());

  // Already-used email → message (same account already has a site)
  await anon.locator('[data-deploy]').click();
  modal = anon.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[name="site"]').fill(`story-b-${STAMP}`);
  await modal.locator('input[name="email"]').fill(email); // already used above
  await modal.locator('button[type="submit"]').click();
  await anon.waitForTimeout(800);
  const reused = await modal.evaluate((el) => {
    const advanced = /check your email|inbox/i.test(el.textContent ?? '');
    const error = (el.querySelector('.error')?.textContent ?? '').trim();
    return { advanced, error };
  });
  // USER_STORIES: already-used email must show a message. Today the stack may
  // accept a second deploy for the same email (product gap) — keep this check
  // strict so the story stays the source of truth.
  check(
    'first-deploy: already-used email shows a message and does not advance',
    !reused.advanced && reused.error.length > 0,
    reused.advanced
      ? 'deploy advanced to check-inbox (reused email was accepted)'
      : reused.error || '(no error)'
  );
  await anonCtx.close();

  // ─────────────────────────────────────────────────────────────
  // Through register button (./docs/USER_STORIES.md)
  // ─────────────────────────────────────────────────────────────
  const regCtx = await browser.newContext();
  const reg = await regCtx.newPage();
  trackPageErrors(reg);
  const regEmail = `reg-${STAMP}@e2e.test`;

  await reg.goto(`${WORKER}/edit/`, { waitUntil: 'domcontentloaded' });
  await reg.frameLocator('iframe.gjs-frame').locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await reg.locator('.register-open').click();
  modal = reg.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  check('register: Register button opens the email form', /register/i.test((await modal.textContent()) ?? ''));

  await modal.locator('input[type="email"]').fill('not-an-email');
  await modal.locator('button[type="submit"]').click();
  await reg.waitForTimeout(400);
  const regBad = await modal.evaluate((el) => {
    const input = el.querySelector('input[type="email"]');
    const advanced = /check your email|inbox/i.test(el.textContent ?? '');
    return { advanced, invalid: input ? !input.checkValidity() : false };
  });
  check(
    'register: invalid email is blocked',
    !regBad.advanced && regBad.invalid,
    JSON.stringify(regBad)
  );

  await modal.locator('input[type="email"]').fill(regEmail);
  await modal.locator('button[type="submit"]').click();
  await reg.locator('.modal', { hasText: /check your email|inbox/i }).waitFor({ timeout: 15000 });
  check('register: valid email shows check-inbox state', true);

  // Same two-tab pattern as the deploy story: confirm elsewhere, then the
  // waiting tab picks the session up on refocus.
  const regConfirmTab = await regCtx.newPage();
  trackPageErrors(regConfirmTab);
  const regConfirm = await mailboxConfirmHref(regConfirmTab, regEmail);
  check('register: inbox (dev-mail) has the magic link', !!regConfirm, regEmail);
  await regConfirmTab.goto(absoluteUrl(regConfirm), { waitUntil: 'domcontentloaded' });
  check(
    'register: confirm link signs the user in',
    /email confirmed|signed in|dashboard/i.test((await regConfirmTab.textContent('body')) ?? '')
  );

  await reg.bringToFront();
  await reg.evaluate(() => window.dispatchEvent(new Event('focus')));
  await reg.waitForURL(/\/dashboard\/?/, { timeout: 15000 });
  // /api/me fills #who asynchronously after navigation
  await reg.locator('#who').waitFor({ state: 'attached', timeout: 15000 });
  await reg.waitForFunction(
    (expected) => (document.getElementById('who')?.textContent ?? '') === expected,
    regEmail,
    { timeout: 15000 }
  ).catch(() => {});
  const who = ((await reg.locator('#who').textContent()) ?? '').trim();
  check('register: dashboard is signed in for that email', who === regEmail, who || '(empty)');
  await reg.locator('input[name="site"]').waitFor({ state: 'visible', timeout: 10000 });
  check('register: dashboard offers claiming a site', true);

  await regCtx.close();
} finally {
  await browser.close();
}

finish();
