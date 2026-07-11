// Invariant regression suite: properties that must always hold, independent of
// which feature was touched.
// 1. Round-trip idempotence: publish → reload → publish yields the same artifact.
// 2. Hit-test sweep: every visible interactive element wins the hit test at its
//    own center (guards invisible-overlay regressions).
// 3. Foreign-origin embed: component modules load and render on a host we don't
//    control (the white-label path — exercises CORS and absolute URLs).
// Usage: node scripts/verify-invariants.mjs (vite on :5199, wrangler dev on :8787)
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const VITE = 'http://localhost:5199';
const WORKER = 'http://localhost:8787';
const EMBED_PORT = 5297;
rmSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'artifacts'), { recursive: true, force: true });

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

const hookArtifacts = () =>
  page.evaluate(() => {
    window.__artifacts = null;
    document.getElementById('editor').addEventListener('artifactsave', (e) => {
      window.__artifacts = e.detail.artifacts;
    });
  });
const publish = async () => {
  await page.evaluate(() => (window.__artifacts = null));
  await page.getByRole('button', { name: /Publish|Save/ }).click();
  await page.waitForFunction(() => window.__artifacts !== null, null, { timeout: 10000 });
  return (await page.evaluate(() => window.__artifacts))[0];
};

try {
  // --- Build a rich editor state: instance style, mobile override, theme, part, text ---
  await page.goto(`${VITE}/?component=pages/Landing`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe.gjs-frame');
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await hookArtifacts();
  const firstCard = frame.locator('archura-card').first();

  await firstCard.click({ position: { x: 10, y: 10 } });
  const fontSize = page.locator('.gjs-sm-property', { hasText: 'Font Size' }).locator('input').first();
  await fontSize.waitFor({ state: 'visible', timeout: 10000 });
  await fontSize.fill('24');
  await fontSize.press('Enter');
  await page.getByRole('button', { name: 'Mobile' }).click();
  await firstCard.click({ position: { x: 10, y: 10 } });
  await fontSize.fill('13');
  await fontSize.press('Enter');
  await page.getByRole('button', { name: 'Desktop' }).click();

  await page.getByRole('button', { name: 'Theme' }).click();
  await page.locator('.panel label', { hasText: 'Text color' }).locator('input').fill('#aa0000');
  await page.getByRole('button', { name: 'Theme' }).click();

  await firstCard.click({ position: { x: 10, y: 10 } });
  await frame.locator('archura-card h3').first().click();
  await page.locator('.part-chip').waitFor({ timeout: 5000 });
  const partColor = page
    .locator('.gjs-sm-sector', { has: page.locator('.gjs-sm-sector-label', { hasText: 'Selected Part' }) })
    .locator('.gjs-sm-property', { hasText: 'Color' })
    .locator('input')
    .first();
  await partColor.fill('#0000aa');
  await partColor.press('Enter');
  await page.locator('.chip-close').click();

  const artifact1 = await publish();

  // --- Invariant 1: round-trip idempotence ---
  await page.reload({ waitUntil: 'domcontentloaded' });
  await frame.locator('archura-hero').waitFor({ state: 'visible', timeout: 20000 });
  await hookArtifacts();
  const artifact2 = await publish();

  const diff = await page.evaluate(
    ([a, b]) => {
      const styleSet = (styleText) =>
        [...styleText.matchAll(/(--?[\w-]+)\s*:\s*([^;]+)/g)].map(([, p, v]) => `${p}:${v.trim()}`).sort();
      const cssTriples = (css) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        const out = [];
        const walk = (rules, media) => {
          for (const rule of rules) {
            if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.conditionText);
            else if (rule instanceof CSSStyleRule) {
              for (const decl of styleSet(rule.style.cssText)) out.push(`${media ?? ''}|${rule.selectorText}|${decl}`);
            } else out.push(rule.cssText);
          }
        };
        walk(sheet.cssRules);
        return out.sort();
      };
      const domShape = (html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const describe = (el) => {
          const attrs = [...el.attributes]
            .map((a) => (a.name === 'style' ? `style=[${styleSet(a.value).join(';')}]` : `${a.name}=${a.value}`))
            .sort();
          return `${el.tagName}(${attrs.join(',')})[${[...el.children].map(describe).join('')}]`;
        };
        return [...doc.body.children].map(describe).join('');
      };
      const diffs = [];
      const c1 = cssTriples(a.snapshot.css);
      const c2 = cssTriples(b.snapshot.css);
      for (const t of c1) if (!c2.includes(t)) diffs.push(`css only in 1st: ${t}`);
      for (const t of c2) if (!c1.includes(t)) diffs.push(`css only in 2nd: ${t}`);
      if (domShape(a.snapshot.html) !== domShape(b.snapshot.html)) diffs.push('html shape differs');
      const content = (art) =>
        JSON.stringify((art.content?.components ?? []).slice().sort((x, y) => x.instanceId.localeCompare(y.instanceId)));
      if (content(a) !== content(b)) diffs.push('content.components differ');
      return diffs;
    },
    [artifact1, artifact2]
  );
  check('invariant: publish → reload → publish is idempotent', diff.length === 0, diff.join(' ; '));

  // --- Invariant 2: hit-test sweep over interactive shell elements ---
  await firstCard.click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(400);
  const hitFailures = await page.evaluate(() => {
    function* walk(root) {
      for (const el of root.querySelectorAll('*')) {
        yield el;
        if (el.shadowRoot) yield* walk(el.shadowRoot);
      }
    }
    const deepFromPoint = (x, y) => {
      let el = document.elementFromPoint(x, y);
      while (el?.shadowRoot) {
        const inner = el.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el;
    };
    const chainContains = (a, b) => {
      // true when a and b are on the same composed ancestor chain
      for (let n = b; n; n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode) {
        if (n === a) return true;
      }
      for (let n = a; n; n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode) {
        if (n === b) return true;
      }
      return false;
    };
    const failures = [];
    for (const el of walk(document)) {
      const interactive =
        ['BUTTON', 'INPUT', 'SELECT'].includes(el.tagName) || el.classList?.contains('gjs-resizer-h');
      if (!interactive) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 6 || rect.height < 6) continue;
      if (rect.top < 0 || rect.left < 0 || rect.bottom > innerHeight || rect.right > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.2) continue;
      const hit = deepFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!hit || !chainContains(el, hit)) {
        failures.push(
          `${el.tagName}.${String(el.className).split(' ')[0]} "${(el.textContent ?? '').trim().slice(0, 24)}" hit=${hit?.tagName}.${String(hit?.className ?? '').split(' ')[0]}`
        );
      }
    }
    return failures;
  });
  check('invariant: every interactive element wins its own hit test', hitFailures.length === 0, hitFailures.join(' ; '));

  // --- Invariant 3: foreign-origin white-label embed ---
  const embedServer = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html>
<html><body>
  <archura-card id="embed" title="Embedded Card" content="Rendered on a host we don't control."
    style="--background-color: #0f172a; --color: #ffffff;"></archura-card>
  <script type="module" src="${WORKER}/components/cards/Card.js"></script>
</body></html>`);
  });
  await new Promise((resolve) => embedServer.listen(EMBED_PORT, resolve));
  try {
    const embedPage = await browser.newPage();
    const consoleErrors = [];
    embedPage.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    await embedPage.goto(`http://localhost:${EMBED_PORT}/`, { waitUntil: 'domcontentloaded' });
    await embedPage.locator('archura-card h3').waitFor({ state: 'visible', timeout: 10000 });
    // Base has `transition: all .2s`; wait out the background transition
    await embedPage
      .waitForFunction(
        () =>
          getComputedStyle(document.querySelector('archura-card')).backgroundColor === 'rgb(15, 23, 42)',
        null,
        { timeout: 5000 }
      )
      .catch(() => {});
    const embedded = await embedPage.evaluate(() => {
      const card = document.querySelector('archura-card');
      return {
        title: card.shadowRoot?.querySelector('h3')?.textContent,
        background: getComputedStyle(card).backgroundColor,
      };
    });
    check(
      'invariant: white-label embed renders cross-origin with inline styling',
      embedded.title === 'Embedded Card' && embedded.background === 'rgb(15, 23, 42)' && consoleErrors.length === 0,
      JSON.stringify({ ...embedded, consoleErrors })
    );
    await embedPage.close();
  } finally {
    embedServer.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
