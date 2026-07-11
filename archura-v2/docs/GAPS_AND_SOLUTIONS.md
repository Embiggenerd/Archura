# Gaps and Solutions — Road to Final Product

## Product definition

Archura is the editor layer of a CMS.

- **Developers** author components and pages **in code**, as Lit elements. Pages compose
  library components in their templates. There is no blocks panel and no drag-and-drop:
  page structure is code-owned.
- **Clients** open a component or page in the editor and edit it visually: content through
  traits, styling through the Base custom-property contract. They cannot restructure the page.
- **Components and pages live on our servers.** When the client hits the publish button, the
  host application deploys (or redeploys) the artifact. Archura emits canonical artifacts;
  the host owns storage and deployment.

Everything below serves that model.

---

## 1. Save/load round trip

**Status: implemented** on `deployable-styles` — verified by `scripts/verify-section1.mjs`
(11 checks: transform correctness, save shape, editor round trip, standalone deploy render).

### Problems

- `loadArtifact()` and `initialArtifact` write html/css into controller state, but GrapesJS
  never reads them — `#componentPlugin` unconditionally calls `editor.setComponents()` with
  trait defaults on load. A saved artifact can never be reopened for editing.
- The artifact's `content` field is always `{}`. Trait values (title, text, etc.) exist only
  inside the html snapshot, so the CMS has no structured content to query or migrate.
- `transformForDeployment()` is lossy: when any custom property exists it returns `css: ''`
  (discarding every other rule), merges custom props from **all** selectors onto the first
  tag, and only rewrites the first `style="` attribute. Wrong as soon as a page has more than
  one styled component.

### Solutions

- **Load path:** when GrapesJS fires `load`, check whether state came from an artifact
  (snapshot present). If yes: `editor.setComponents(state.html)` + `editor.setStyle(state.css)`.
  Only seed the trait-default markup when there is no snapshot (fresh component).
- **Structured content:** at save time, walk the GrapesJS component tree; for every
  `archura-*` component record `{ componentPath, instanceId, attributes }` into
  `content.components`. This gives the CMS structured, queryable content alongside the
  rendered snapshot, and makes future content-only updates possible.
- **Correct deployment transform:** iterate CSS rules and match each rule's selector against
  the elements in the saved html (GrapesJS styles components via generated ids/classes).
  Inline that rule's custom properties onto **the matching element only**. Any CSS that is
  not a custom-property declaration stays in `snapshot.css` instead of being discarded; the
  deploy target renders it in a `<style>` tag if present.

### Verify

Save → reload editor from artifact → identical canvas. Two components on one page styled
differently → each deployed element carries only its own custom props.

---

## 2. Component loading (decouple from the dev server)

**Status: implemented** on `component-registry` — verified by `scripts/verify-section2.mjs`
(5 checks: default registry URL resolution, editor regression, custom definition identity,
onError for unregistered paths and failing module loads), plus §1 suite as regression.

### Problem

The controller loads component modules from a hard-coded `/src/components/${path}.js` URL,
which only resolves inside this Vite project. Unusable as an installed package.

### Solution

An explicit component registry. Module URLs are the host↔editor contract because custom
elements must be defined inside the canvas iframe's realm — constructors cannot be passed
across realms.

```ts
type ArchuraComponentDefinition = {
  kind: 'component' | 'page';
  path: string[];      // identity, e.g. ['cards', 'Card'] or ['pages', 'Landing']
  tagName: string;     // 'archura-card'
  moduleUrl: string;   // injected into the canvas iframe as <script type="module">
  label?: string;      // shown in the editing-target breadcrumb
};
```

- The package ships its built-in library as `defaultComponents`, resolving URLs with
  `new URL('./components/cards/Card.js', import.meta.url)` so they are correct wherever the
  package is installed.
- The host registers its own definitions pointing at built component modules served from our
  servers. Same shape, no special casing.
- `#componentPlugin` takes `tagName` and `moduleUrl` from the definition instead of deriving
  them. Trait introspection from `static properties` is unchanged.
- **The registry is not a separate package.** It is a type plus a lookup and ships with the
  editor. The seam that matters is editor engine vs component library — different consumers
  (edit time vs every deployed page) — expressed as package entry points: `archura` for the
  editor, `archura/components/*` for individually importable component modules.
- **Definitions are plain serializable data** (all strings). They can be statically imported
  or fetched from the CMS backend — the component catalog can live in a database and be
  served per client.

### Verify

Install the built package into a bare host project with no `/src/components` directory;
the Card loads and is editable.

---

## 3. Page composition — in code, no drag-and-drop

**Status: implemented** on `page-editing` — verified by `scripts/verify-section3.mjs`
(10 checks: expansion, locked structure, per-card styling, content collection, breadcrumb,
round trip, standalone deploy), with §1/§2 suites as regression. First page:
`src/components/pages/Landing.js` (Hero + two Cards) via `PageBase`.

### Decision (product feedback)

No blocks panel. No drag-and-drop. Developers compose pages as Lit elements whose templates
contain library components. Clients edit the components on the page but cannot add, remove,
or move them.

### Solution

- **Pages are registry entries** with `kind: 'page'`. A page definition lists the component
  definitions it uses so the controller can inject every needed module into the canvas.
- **Pages render into light DOM.** Page elements extend a `PageBase` that overrides
  `createRenderRoot() { return this; }`. Shadow DOM breaks page editing in two independent
  ways: GrapesJS never parsed the shadow contents so it has no component-model nodes for
  them, and shadow event retargeting rewrites `event.target` to the page host, so clicks
  could only ever select the page itself. Leaf components keep their shadow DOM as usual —
  GrapesJS owns their host element, traits are host attributes, and the Base styling
  contract works because CSS custom properties inherit through shadow boundaries.
- **Pages are expanded to markup at load time — light DOM alone is not enough.** Lit renders
  the page's children at runtime, so GrapesJS still has no model nodes for them until we:
  1. inject the page module into the canvas iframe, create the page element, and
     `await el.updateComplete`;
  2. serialize the rendered **children** (not the page element) into a neutral wrapper and
     pass that to `setComponents()`.

  Serializing the page element itself is a trap: GrapesJS would re-create a live
  `<archura-page-*>`, the upgrade would re-run Lit's render into an element that already
  contains GrapesJS-owned children, and the DOM gets clobbered (double render). The page
  element is a **dev-time authoring construct**; the canvas contains its composition, never
  the element itself. Consequently the deployed snapshot is plain leaf-component markup —
  the page wrapper's JS never ships.
- **`PageBase` authoring constraints (document loudly):**
  - `static styles` is silently ignored without a shadow root. Pages should be nearly
    style-free — structure via wrapper `div`s, appearance owned by leaf components. Genuine
    page layout CSS ships as a scoped global sheet (`archura-page-landing > .row { ... }`)
    registered alongside the page definition.
  - `<slot>` does not work without shadow DOM. Non-issue: pages are top-level compositions.
  - Page markup is exposed to document CSS (canvas reset, host styles) — usually desirable,
    but a behavioral difference from normal Lit authoring.
- **Structure is locked.** Every component in a page target is registered with
  `draggable: false, droppable: false, removable: false, copyable: false`. Selecting an
  instance shows its traits and custom-property styles — nothing else.
- **Known tension — template vs instance:** re-editing loads from the saved artifact
  snapshot (§1), so once a client edits a page it is detached from its source template;
  later changes to the page's Lit code do not flow into saved artifacts. Classic CMS
  behavior, born at the expansion step. Acceptable for now; revisit if template migration
  becomes a requirement.
- **Editing target is first-class.** The controller exposes
  `getTarget(): { target: ArchuraEditTarget; label: string }` and notifies renderables when
  it changes. The shell/toolbar renders a breadcrumb from it — `Pages / Landing` or
  `Components / Card` — so it is always visible what is being edited, sourced from the same
  state the save path uses.
- **Save** emits one page artifact: whole-page snapshot plus the structured `content.components`
  map from §1, keyed by instance.

### Verify

Open a page with two Card instances; style each differently; confirm neither can be moved or
deleted; save; reload; deploy snapshot renders both correctly standalone.

---

## 4. Packaging

### Problem

`package.json` is `private: true` with no `exports`/`types` fields, and `build` only runs
`tsc` — no bundle, no shipped component modules, no CSS strategy for the imported
`grapes.min.css`.

### Solution

- **The package lives at `archura-v2/` as-is** — it is already a self-contained npm package.
  `src/` builds to a published `dist/` (`"files": ["dist"]`); `demo/`, `index.html`, `docs/`,
  and `scripts/` are repo-only. No workspace monorepo: revisit only when deployed client
  pages need to pin component versions independently of editor releases.
- Vite **lib mode** build emitting ESM + type declarations, with the component/page modules
  copied as importable assets (required by the `import.meta.url` registry in §2).
- `exports` map: main entry (controller + elements + types), `./components/*` for the
  built-in library modules, `./styles.css` for the GrapesJS-derived stylesheet the host must
  include (documented, not silently injected into `document.head`).
- README documenting the three integration surfaces (`<archura-editor>`, composed primitives,
  raw controller) and the host contract: register components, handle `onSave`/`onPublish`,
  include the stylesheet.

### Verify

`npm pack`, install the tarball into a clean Vite host, run the full edit → publish flow.

---

## 5. Contract gaps (save vs publish, errors, lifecycle)

**Status: implemented** on `persistence-adapter` — verified by `scripts/verify-section5.mjs`
(10 checks: publish through the filesystem adapter, load-on-open, preview from the store,
toolbar state cycle, failure handling, R2 adapter round trip + auth), §1–§3 as regression.

### Problems

- Single "Save" button with no deployment semantics, while the product requires
  client-triggered deployment.
- `onError` exists in config but is never invoked anywhere.
- `save()` always emits exactly one artifact but is typed as an array.
- `<archura-editor>` never calls `controller.destroy()` on disconnect; the mount guards
  prevent remounting after teardown.

### Solutions

- **Persistence adapter — the editor's entire knowledge of storage:**

  ```ts
  type ArchuraPersistenceAdapter = {
    load(target: ArchuraEditTarget): Promise<CanonicalComponentData | null>;
    publish(artifact: CanonicalComponentData): Promise<void>;
  };
  ```

  The host passes `persistence` in config. The controller calls `load()` when it opens a
  target (replacing the `initialArtifact` config) and `publish()` when the client hits the
  button, awaiting both — which drives the toolbar's
  `Publish → Publishing… → Published` (or failure) states. S3, R2, a local database: all
  just adapter implementations in host code; the editor cannot tell them apart.
  - The package ships the type plus two adapters (decision amended by product feedback):
    `createFileSystemAdapter()` for local testing (backed by the dev server's
    `artifact-store` middleware, which writes `artifacts/<componentPath>.json`) and
    `createR2Adapter({ endpoint, token })` for Cloudflare R2, which talks to a Worker
    fronting the bucket (reference implementation: `workers/r2-artifact-worker.js`;
    browser code never holds R2 credentials). Both are thin HTTP clients over the same
    GET/PUT JSON contract; `/mock-r2` in vite.config.ts mimics the Worker so the R2
    adapter is testable offline.
  - **No `saveDraft` yet.** The product flow is load → edit → publish. Add a draft method
    when drafts become a real requirement; adding later is painless, removing is not.
  - `onChange`/`onError` remain as notification hooks — they are not persistence.
- **Wire `onError`:** canvas module script `onerror`, GrapesJS init failures, and rejected
  `onPublish` promises all route through it (and through the `editorerror` event on
  `<archura-editor>`).
- **Artifact contract:** one artifact per save/publish; keep the array shape for future
  multi-artifact output but document the current cardinality.
- **Lifecycle:** `<archura-editor>` calls `controller.destroy()` in `disconnectedCallback`;
  mount methods allow re-initialization after destroy.

### Verify

Publish with a host callback that resolves after 500ms → button shows the full state cycle.
Publish with a rejecting callback → error surfaces via `editorerror`, editor remains usable.

---

## 6. Verification and documentation

**Status: regression system in place** — `npm run verify:all` builds, starts fresh
servers, and runs all 8 suites (74 checks, ~35s): the per-phase suites
(`verify-section*`, `verify-parity*`, `verify-deploy`) plus `verify-invariants`, which
holds properties independent of any feature: publish → reload → publish idempotence
(this forced durable instance ids — stamped before snapshot), a hit-test sweep (every
visible interactive element must win `elementFromPoint` at its own center; guards
invisible-overlay regressions), and a foreign-origin white-label embed render (caught a
real bug: component-module assets needed CORS headers for cross-origin module scripts).

### Problems

- Playwright is installed but there are zero tests.
- `ARCHURA.md` is stale (still claims GrapesJS is not wired in).

### Solutions

- **End-to-end Playwright suite** covering the product loop:
  1. Open a component target → edit a trait and a style → save → assert canonical artifact
     shape, `content.components`, and per-element inlined custom props.
  2. Open a page target → edit two instances → verify structure is locked → publish →
     assert `onPublish` payload.
  3. Render the deployed snapshot in a page with **no editor code loaded** → assert it looks
     right (screenshot or computed-style assertions). This test is the point of the whole
     deployable-styles effort.
  4. Reload-from-artifact round trip (§1).
- **Docs:** update `ARCHURA.md` to current reality and link this file; keep both current as
  the phases land.

---

## 7. Serving layer — claim a subdomain, publish, live site

**Status: implemented** on `demo-deploy` — verified by `scripts/verify-deploy.mjs`
(8 checks against `wrangler dev`: claim flow, bundled modules, publish, served site,
live update without reload, token/claim security, placeholder page, editor restore).

### Product goal (2026-07-10)

A user claims a custom subdomain, edits their page, clicks publish, and the page is live
at `<name>.<domain>` — with open viewers seeing re-publishes without refreshing.

### Solution

- **One Worker, three jobs** (`workers/site-worker.js`), routed by hostname:
  editor app + `/api/*` on the apex; published sites on wildcard subdomains;
  `/s/<name>/` path fallback serves sites on workers.dev and under `wrangler dev`.
- **Claim tokens**: `POST /api/sites` reserves a name, stores a SHA-256 hash of a random
  token in `sites/<name>/meta.json` (R2), returns the token once; the browser keeps it in
  localStorage. Publishes require it as a bearer header; reads are public. No accounts —
  upgrade path is swapping the ownership check, nothing else changes.
- **Same adapter contract**: the editor talks to the Worker through the §5 `createR2Adapter`
  pointed at `/api/artifacts/<site>` — the serving layer required zero editor changes.
- **Component modules built for the world**: `scripts/build-components.mjs` bundles each
  leaf component (and the Landing page module for the editor canvas) as self-contained ESM
  (lit inlined) into `dist/components/*`, served as Worker assets. Component classes now
  guard their `customElements.define` since bundling means a class can arrive via two URLs.
- **Site shell**: the Worker renders `<style>` + snapshot html + one module script per
  unique `content.components[].componentPath`, plus a poll script comparing
  `meta.updatedAt` every 3s that swaps css/html in place — live updates, no reload.
- **Deploy**: `npm run deploy` (vite build + component bundles + `wrangler deploy`);
  `wrangler.toml` needs `ROOT_DOMAIN` + zone routes filled in for real subdomains.

### Still ahead (vision layers, undesigned)

Site-level artifact (multi-page + routing), versioned CDN component distribution,
composer mode (agents/templates may create structure), real accounts, §4 npm packaging.

---

## Suggested order

1. §1 save/load + deployment transform (current `deployable-styles` branch finishes here)
2. §2 registry
3. §3 pages + editing-target breadcrumb
4. §5 publish flow + error/lifecycle hardening
5. §4 packaging
6. §6 test suite hardening throughout; docs at each phase
