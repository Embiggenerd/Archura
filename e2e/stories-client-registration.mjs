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

  // Index → editor
  await page.goto(`${WORKER}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/edit\/?/, { timeout: 10000 });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  check('first-deploy: index lands on the editor with a canvas', true);

  const committed = await editFirstCardTitle(page, frame, marker);
  check('first-deploy: user can edit the page before deploy', committed === marker, committed);

  // Invalid email → message / no advance
  await page.locator('.deploy-open').click();
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

  // Dev mailbox → confirm link (stand-in for the email)
  const confirmHref = await mailboxConfirmHref(page, email);
  check('first-deploy: inbox (dev-mail) has the confirmation link', !!confirmHref, email);

  await page.goto(absoluteUrl(confirmHref), { waitUntil: 'domcontentloaded' });
  const confirmedBody = await page.textContent('body');
  check('first-deploy: confirm link opens the confirmed page', /email confirmed/i.test(confirmedBody ?? ''));

  // “Link to his site” on the confirmed page → loader → live content
  const openSite = page.getByRole('link', { name: /open your site/i });
  await openSite.waitFor({ timeout: 10000 });
  await openSite.click();
  await page.waitForURL(new RegExp(`/s/${site}/?`), { timeout: 15000 });

  // Loader may flash briefly; wait until the edited site is live
  await page.locator('archura-hero').waitFor({ state: 'visible', timeout: 25000 });
  const liveTitle = await page.locator('archura-card').first().getAttribute('title');
  check(
    'first-deploy: site matches what the user edited',
    liveTitle === marker,
    liveTitle ?? '(null)'
  );

  // Taken subdomain → message
  await page.goto(`${WORKER}/edit/`, { waitUntil: 'domcontentloaded' });
  await page.frameLocator('iframe.gjs-frame').locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('.deploy-open').click();
  modal = page.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[name="site"]').fill(site); // already used
  await modal.locator('input[name="email"]').fill(`other-${STAMP}@e2e.test`);
  await modal.locator('button[type="submit"]').click();
  await page.waitForTimeout(800);
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
  await page.evaluate(() => document.querySelector('.overlay')?.remove());

  // Already-used email → message (same account already has a site)
  await page.locator('.deploy-open').click();
  modal = page.locator('.modal');
  await modal.waitFor({ state: 'visible' });
  await modal.locator('input[name="site"]').fill(`story-b-${STAMP}`);
  await modal.locator('input[name="email"]').fill(email); // already used above
  await modal.locator('button[type="submit"]').click();
  await page.waitForTimeout(800);
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
  await ctx.close();

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

  const regConfirm = await mailboxConfirmHref(reg, regEmail);
  check('register: inbox (dev-mail) has the magic link', !!regConfirm, regEmail);
  await reg.goto(absoluteUrl(regConfirm), { waitUntil: 'domcontentloaded' });
  check(
    'register: confirm link signs the user in',
    /email confirmed|signed in|dashboard/i.test((await reg.textContent('body')) ?? '')
  );

  const dashLink = reg.getByRole('link', { name: /dashboard/i }).first();
  if (await dashLink.count()) await dashLink.click();
  else await reg.goto(`${WORKER}/dashboard/`, { waitUntil: 'domcontentloaded' });

  await reg.waitForURL(/\/([0-9a-fA-F-]{8,})\/dashboard\/?/, { timeout: 15000 });
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
