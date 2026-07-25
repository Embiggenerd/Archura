// Harness host for REAL compiler output: mounts the unchanged Archura editor
// with the registry produced by build-real.mjs (converted moduleUrl values).
import '../src/index.ts';

const PREFIX = 'archura-harness-real:';

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

const definitions = await (await fetch('/out-real/registry.json')).json();
const pageDefinition = definitions.find((definition) => definition.kind === 'page');

const editor = document.createElement('archura-editor');
editor.id = 'editor';
editor.componentPath = pageDefinition.path;
editor.components = definitions;
editor.persistence = store;
document.body.appendChild(editor);

window.__harness = {
  editor,
  store,
  definitions,
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
