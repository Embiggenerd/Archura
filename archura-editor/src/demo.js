import { defaultComponents } from './components/index.js';

// Injected by Vite from the repo-root .env — a Stripe *publishable test* key, or
// '' if none. Demo-only (see below); components never default a key.
const DEMO_STRIPE_PK = __DEMO_STRIPE_PK__;

// ?component=<path> renders that component live. Every other search param that
// matches a declared property becomes an attribute — handled by Base for ALL
// components, so nothing here special-cases attributes. This page picks the
// component, shows what was applied, and — for the demo only — defaults a Stripe
// test key so payment components show a real form instead of the mock preview.
// Wrapped in an async IIFE (no top-level await — the build target forbids it).
(async () => {
  const params = new URLSearchParams(location.search);
  const compPath = params.get('component');
  const info = document.getElementById('info');
  const editLink = document.getElementById('edit-link');
  const def = defaultComponents.find((d) => d.path.join('/') === compPath);

  if (compPath) editLink.href = `/edit/?component=${compPath}`;

  if (!compPath || !def) {
    info.textContent = compPath
      ? `Unknown component: ${compPath}`
      : 'Add ?component=<path>, e.g. ?component=payments/StripePayment';
    return;
  }

  await import(/* @vite-ignore */ def.moduleUrl);
  const el = document.createElement(def.tagName);

  // Demo-only: if the component accepts a Stripe publishable key and none was
  // passed in the URL, default to our test key so the demo shows a real (test-
  // mode) Stripe form. The component itself never does this — it embeds in other
  // people's apps. An explicit ?stripe-publishable-key=… still wins.
  if (DEMO_STRIPE_PK && !params.has('stripe-publishable-key')) {
    const props = el.constructor.elementProperties;
    const accepts = props && [...props.values()].some((o) => o.attribute === 'stripe-publishable-key');
    if (accepts) el.setAttribute('stripe-publishable-key', DEMO_STRIPE_PK);
  }

  // Appending triggers Base's connectedCallback, which applies the search
  // params to the component's declared properties.
  document.getElementById('root').appendChild(el);

  const applied = [...params].filter(([k]) => k !== 'component').map(([k, v]) => `${k}="${v}"`);
  info.textContent = `<${def.tagName}${applied.length ? ' ' + applied.join(' ') : ''}>`;
})();
