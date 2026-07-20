// Editor capabilities against Vite — text, part styling, resize.
// Hard-fails if Vite is down. HEADED=1 for a visible browser.
import {
  createChecks,
  resolveVite,
  launchBrowser,
  trackPageErrors,
} from './lib/harness.mjs';

const { check, finish } = createChecks();

const VITE = await resolveVite();
if (!VITE) {
  console.error(
    'FAIL — Vite editor not ready (tried E2E_VITE / :5199 / :5173–5176). ' +
      'Start the stack (e.g. sh scripts/dev-up.sh) and re-run.'
  );
  process.exit(2);
}
console.log(`using Vite ${VITE}`);

const browser = await launchBrowser();
const page = await browser.newPage();
trackPageErrors(page);

try {
  await page.goto(`${VITE}/edit/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  check('load: Landing page renders hero in the canvas', true);

  const firstCard = frame.locator('archura-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: 10000 });

  // Theme background reaches the card host
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.locator('.panel label', { hasText: 'Background' }).locator('input').fill('#00ff00');
  await page.getByRole('button', { name: 'Theme' }).click();
  await page
    .waitForFunction(
      () => {
        const card = document.querySelector('iframe')?.contentDocument?.querySelector('archura-card');
        return card ? getComputedStyle(card).backgroundColor === 'rgb(0, 255, 0)' : false;
      },
      null,
      { timeout: 5000 }
    )
    .catch(() => {});
  const cardBg = await firstCard.evaluate((el) => getComputedStyle(el).backgroundColor);
  check('style: theme background reaches the card host', cardBg === 'rgb(0, 255, 0)', cardBg);

  // Part-level color on title
  await firstCard.click({ position: { x: 10, y: 10 } });
  await frame.locator('archura-card h3').first().click();
  await page.locator('.part-chip', { hasText: 'title' }).waitFor({ timeout: 5000 });
  const partColor = page
    .locator('.gjs-sm-sector', { has: page.locator('.gjs-sm-sector-label', { hasText: 'Selected Part' }) })
    .locator('.gjs-sm-property', { hasText: 'Color' })
    .locator('input')
    .first();
  await partColor.fill('#ff0000');
  await partColor.press('Enter');
  const titleStyles = await firstCard.evaluate((el) => ({
    title: getComputedStyle(el.shadowRoot.querySelector('h3')).color,
    content: getComputedStyle(el.shadowRoot.querySelector('p')).color,
  }));
  check(
    'style: title part color is independent of content',
    titleStyles.title === 'rgb(255, 0, 0)' && titleStyles.content !== 'rgb(255, 0, 0)',
    JSON.stringify(titleStyles)
  );
  await page.locator('.chip-close').click();

  // Inline text
  const MARKER = `E2E Text ${Date.now().toString(36)}`;
  await frame.locator('archura-card h3').first().dblclick();
  await page.keyboard.type(MARKER);
  await frame.locator('archura-hero').click({ position: { x: 10, y: 10 } });
  let editedTitle = '';
  for (let i = 0; i < 25; i++) {
    editedTitle = (await firstCard.getAttribute('title')) ?? '';
    if (editedTitle === MARKER) break;
    await page.waitForTimeout(200);
  }
  check('text: double-click edit commits to the title attribute', editedTitle === MARKER, editedTitle);

  // Resize → --width
  await firstCard.click({ position: { x: 10, y: 10 } });
  const handle = page.locator('.gjs-resizer-h-cr').first();
  await handle.waitFor({ state: 'visible', timeout: 5000 });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  let resized = '';
  for (let i = 0; i < 10; i++) {
    resized = await firstCard.evaluate((el) => getComputedStyle(el).getPropertyValue('--width').trim());
    if (/(px|%)$/.test(resized)) break;
    await page.waitForTimeout(200);
  }
  check('resize: dragging the right handle writes --width', /(px|%)$/.test(resized), `--width="${resized}"`);

  // Device switcher affects frame width (locator pierces shadow; querySelector does not)
  await page.getByRole('button', { name: 'Desktop' }).click();
  await page.waitForTimeout(300);
  const widthBefore = Math.round((await page.locator('iframe.gjs-frame').boundingBox()).width);
  await page.getByRole('button', { name: 'Mobile' }).click();
  await page.waitForTimeout(400);
  const widthAfter = Math.round((await page.locator('iframe.gjs-frame').boundingBox()).width);
  check(
    'responsive: Mobile device narrows the canvas frame',
    widthAfter > 0 && widthAfter < widthBefore,
    `${widthBefore} → ${widthAfter}`
  );
} finally {
  await browser.close();
}

finish();
