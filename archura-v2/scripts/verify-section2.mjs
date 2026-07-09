// Verification for GAPS_AND_SOLUTIONS §2: component registry.
// Usage: node scripts/verify-section2.mjs (expects vite dev server on :5199)
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));

try {
  await page.goto(`${BASE}/?component=cards/Card`, { waitUntil: 'domcontentloaded' });

  // --- 1. defaultComponents resolve module URLs via import.meta.url ---
  const defs = await page.evaluate(async () => {
    const { defaultComponents } = await import('/src/editor/index.ts');
    return defaultComponents;
  });
  check(
    'registry: defaultComponents ships Card with absolute module URL',
    defs.length === 1 &&
      defs[0].tagName === 'archura-card' &&
      defs[0].moduleUrl.startsWith('http') &&
      defs[0].moduleUrl.endsWith('/src/components/cards/Card.js'),
    JSON.stringify(defs)
  );

  // --- 2. Default registry drives the normal editor flow (regression) ---
  const card = page.frameLocator('iframe.gjs-frame').locator('archura-card');
  await card.waitFor({ state: 'visible', timeout: 15000 });
  check('registry: editor renders Card via default registry', (await card.getAttribute('title')) === 'Card Title');

  // --- 3. Custom definition: path/tagName/moduleUrl all come from the definition ---
  const custom = await page.evaluate(async () => {
    const { ArchuraEditorController } = await import('/src/editor/ArchuraEditorController.ts');
    const host = document.createElement('div');
    host.id = 'custom-host';
    host.style.cssText = 'width:800px;height:400px;';
    document.body.appendChild(host);

    const controller = new ArchuraEditorController({
      componentPath: ['client-x', 'FancyCard'],
      components: [
        {
          kind: 'component',
          path: ['client-x', 'FancyCard'],
          tagName: 'archura-card',
          moduleUrl: '/src/components/cards/Card.js',
          label: 'Fancy Card',
        },
      ],
    });
    await controller.init();
    controller.mountCanvas(host);

    // Wait until the component renders inside the canvas iframe
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const poll = () => {
        const el = host.querySelector('iframe')?.contentDocument?.querySelector('archura-card');
        if (el?.shadowRoot?.querySelector('h3')) return resolve();
        if (Date.now() > deadline) return reject(new Error('custom component never rendered'));
        setTimeout(poll, 100);
      };
      poll();
    });

    const [artifact] = await controller.save();
    return artifact;
  });
  const entry = custom.content?.components?.[0];
  check(
    'registry: custom definition renders and saves with its own identity',
    custom.config.componentPath.join('/') === 'client-x/FancyCard' &&
      entry?.tagName === 'archura-card' &&
      entry?.componentPath.join('/') === 'client-x/FancyCard' &&
      entry?.attributes.title === 'Card Title',
    JSON.stringify({ config: custom.config, content: custom.content })
  );

  // --- 4. Unregistered path reports through onError ---
  const errors = await page.evaluate(async () => {
    const { ArchuraEditorController } = await import('/src/editor/ArchuraEditorController.ts');
    const host = document.createElement('div');
    host.style.cssText = 'width:400px;height:200px;';
    document.body.appendChild(host);
    const seen = [];
    const controller = new ArchuraEditorController({
      componentPath: ['nope', 'Missing'],
      onError: (e) => seen.push(String(e)),
    });
    await controller.init();
    controller.mountCanvas(host);
    await new Promise((r) => setTimeout(r, 500));
    return seen;
  });
  check(
    'registry: unregistered componentPath routes to onError',
    errors.length === 1 && errors[0].includes('nope/Missing'),
    JSON.stringify(errors)
  );

  // --- 5. Broken module URL reports through onError ---
  const loadErrors = await page.evaluate(async () => {
    const { ArchuraEditorController } = await import('/src/editor/ArchuraEditorController.ts');
    const host = document.createElement('div');
    host.style.cssText = 'width:400px;height:200px;';
    document.body.appendChild(host);
    const seen = [];
    const controller = new ArchuraEditorController({
      componentPath: ['broken', 'Broken'],
      components: [
        {
          kind: 'component',
          path: ['broken', 'Broken'],
          tagName: 'archura-broken',
          moduleUrl: '/no/such/module.js',
        },
      ],
      onError: (e) => seen.push(String(e)),
    });
    await controller.init();
    controller.mountCanvas(host);
    await new Promise((resolve) => {
      const deadline = Date.now() + 10000;
      const poll = () => (seen.length > 0 || Date.now() > deadline ? resolve() : setTimeout(poll, 100));
      poll();
    });
    return seen;
  });
  check(
    'registry: failing module load routes to onError',
    loadErrors.length === 1 && loadErrors[0].includes('/no/such/module.js'),
    JSON.stringify(loadErrors)
  );
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
