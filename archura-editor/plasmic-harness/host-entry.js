// Harness host page: mounts the unchanged Archura editor with the fixture
// registry, exactly the way an external host would — definitions in, a
// persistence store in, nothing else. localStorage-backed store so save /
// reload / publish survive real page reloads.
import '../src/index.ts';

const PREFIX = 'archura-harness:';

const store = {
  async get(key) {
    return localStorage.getItem(PREFIX + key);
  },
  async put(key, value) {
    localStorage.setItem(PREFIX + key, value);
  },
  async delete(key) {
    localStorage.removeItem(PREFIX + key);
  },
};

const definitions = [
  {
    kind: 'component',
    path: ['plasmic', 'fixture', 'pricingcard'],
    tagName: 'archura-fixture-pricingcard-k3x9q2',
    moduleUrl: new URL('/out/PricingCard.js', location.href).href,
    label: 'Pricing Card (fixture)',
  },
  {
    kind: 'page',
    path: ['plasmic', 'fixture', 'landing'],
    tagName: 'archura-fixture-landing-m7p4w8',
    moduleUrl: new URL('/out/Landing.js', location.href).href,
    label: 'Fixture Landing',
    uses: [['plasmic', 'fixture', 'pricingcard']],
  },
];

const editor = document.createElement('archura-editor');
editor.id = 'editor';
editor.componentPath = ['plasmic', 'fixture', 'landing'];
editor.components = definitions;
editor.persistence = store;
document.body.appendChild(editor);

window.__harness = {
  editor,
  store,
  controller: () => editor.getController(),
  dump: () =>
    Object.fromEntries(
      Object.entries(localStorage)
        .filter(([key]) => key.startsWith(PREFIX))
        .map(([key, value]) => [key.slice(PREFIX.length), value])
    ),
  reset: () => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  },
};
