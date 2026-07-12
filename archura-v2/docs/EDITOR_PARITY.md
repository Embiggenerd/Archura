# Editor Parity — Road to a Webflow-Level Editor

Progress tracker for closing the editor-capability gap with Webflow, ranked by how much
each gap changes what a user can make. Companion to `GAPS_AND_SOLUTIONS.md` (platform
gaps); this file tracks the *editing experience*.

## The ambition line

**Squarespace's ease with Webflow-quality output.** Webflow is a visual CSS/DOM designer
with a steep learning curve; its freeform power is exactly the breakable-by-design surface
Archura rejects. We are building the *constrained* editor to Webflow-grade capability and
polish. Target user: the business client Webflow filters out. Every gap below closes
*inside* the custom-property contract — none may break the mistakeless envelope.

## Already structurally comparable

- Select → style panel → live canvas (same interaction skeleton).
- Publish pipeline: claim → publish → live subdomain in seconds, open viewers update
  live (~3s poll). Webflow does not do the live-viewer part.
- Component model: Webflow Symbols ≈ registered components, plus the mistakeless guarantee.

## Deliberately not chasing

Freeform element dragging, arbitrary classes/CSS, custom code embeds — the places Webflow
users break their own sites, and where its learning curve comes from. The theme-token
panel (§4) is the pressure valve that keeps "custom CSS" off the roadmap. The constrained
counterpart to Webflow interactions is §8 presets, not a timeline editor.

---

## 1. Responsive editing

**Status: implemented** — device switcher (Desktop/Tablet/Mobile) that visibly resizes
the canvas frame (browser-responsive-mode style: fixed-width devices render as a centered
column on a gray desk, activating their media queries live), adjustable preview width, and
the per-property deployment split. Verified by `scripts/verify-responsive.mjs` (frame
resize, live width edit, mobile edits authoring into `@media (max-width: 767px)`, deployed
page honoring the breakpoint) and `scripts/verify-parity.mjs`.

Two-width model (mirrors browser DevTools / GrapesJS): a device's `width` is the *preview*
(adjustable, what the frame renders at) and `widthMedia` is the fixed *authoring bucket*
(the `@media` a device's edits write into). Changing the preview never moves the bucket.
Fix that made it real: the canvas `width: 100% !important` overrides were letting the
frame ignore the DeviceManager; now the viewport fills and the frame is device-sized.

Editable breakpoints (Framer-style, desktop-first, verified by
`scripts/verify-breakpoints.mjs`): the Breakpoints panel edits each bucket's max-width
threshold (kept separate from the preview width). Changing a threshold **migrates** every
rule already authored in that bucket to the new width at once (rekeys the `@media` in
CssComposer) — no orphaning — and re-bounces the active device so subsequent edits target
the new bucket. Thresholds are validated (distinct, 40px min gap) and persisted in
`content.breakpoints`, reconciled on load so CSS media values and stored thresholds can't
drift. Deliberately scoped: max-width only (no min-width/larger breakpoints), tab-switch
(no side-by-side frames), ≤3 buckets. Mobile-first cascade is a deferred foundational
decision (flips base-style meaning + inline-deploy semantics; one-time migration).

Remaining polish: style-source indicators ("set here" vs "inherited"); optional
DevTools-style drag handle on the frame edge (numeric width control ships today).

### Problem

Webflow's breakpoint cascade is its heart; we have a single Desktop device. Styles apply
identically at every viewport, and business sites are judged on phones.

### Solution

Per-breakpoint custom properties, staying inside the existing contract:

- Device switcher in the toolbar (desktop / tablet / mobile) driving GrapesJS's
  DeviceManager (already configured, single-device today).
- Style manager writes into the active breakpoint's media query; GrapesJS CssComposer
  supports per-device rules natively.
- `transformForDeployment` learns media queries with a **per-property split** (required
  for correctness: inline styles beat media-query rules, so a base value inlined on the
  element would suppress its own mobile override forever):
  - property with no breakpoint overrides → inline as today;
  - property with any breakpoint override → not inlined at all; base + overrides emitted
    as id-scoped rules in `snapshot.css`, ordered wide → narrow so plain cascade resolves
    them (no `!important`).
- Webflow-model reference: desktop-first base + `max-width` delta cascade, canvas as a
  genuinely resized viewport, per-breakpoint style storage. GrapesJS ships the machinery
  (DeviceManager, per-device CssComposer rules); the known UX gap vs Webflow is style
  *source indicators* ("set here" vs "inherited") — v1 accepts weak indicators, add a
  set-at-this-breakpoint marker as fast-follow.
- Canvas viewport resizes per device so edits are seen at the target width.

### Verify

Set a card's `--padding` differently on desktop and mobile → publish → deployed page
shows both (resize window); round trip preserves both; §1–§3 suites still pass.

---

## 2. Images and assets

**Status: implemented** — asset trait type (upload + preview), Hero `logoSrc` slot,
`Image` component, browser-side downscale, content-hash immutable stores (dev middleware
+ Worker/R2); verified by `scripts/verify-parity.mjs`.

### Problem

No image component, no upload, no asset storage. Disqualifying for real business sites.

### Solution

Placement is authored, not arranged: components declare image *slots* as asset traits
(`logoSrc: { type: String, asset: true }`); the client fills the slot, and layout
integrity stays in the component's hands (`height: var(--logo-height, 48px); width:
auto; object-fit: contain` — any uploaded aspect ratio renders correctly).

- `Image` component (`src`/`alt` asset+text traits) and a `logoSrc` slot on Hero.
- Two sizes, two owners: display size is component CSS + exposed knobs; file size is
  the upload pipeline — browser-side canvas downscale (long edge ≤1024px) before upload.
- Asset pipeline: `PUT /api/assets/<site>/<name>` (claim-token gated) → **content-hash
  filename** in R2 → immutable cache forever; replacing an image mints a new URL, so
  live-update polling propagates it with zero cache invalidation.
- Traits store the **absolute URL** (embed-safe on foreign origins); artifacts stay
  JSON — image bytes never enter artifacts or editor state.
- Editor: `asset` trait type (upload button + preview), host provides `uploadAsset` in
  config (same boundary as the persistence adapter).
- PNG/JPEG/WebP only in v1. SVG deferred: it is a script container — when it comes, it
  arrives with `Content-Security-Policy: sandbox` on asset responses.

### Verify

Upload an image, place it in a Hero, publish → deployed subdomain serves page and asset;
reload editor restores it; asset survives artifact round trip.

---

## 3. Typography

**Status: implemented** — 8 curated Google fonts in the style manager and Theme panel;
canvas loads them; the site shell emits font links only for families the page uses.
(Site-config storage turned out unnecessary: the shell derives usage from the snapshot.)

### Problem

The font trait lists ten system fonts. Brand typography is table stakes.

### Solution

- Google Fonts picker in the style manager (curated list first — popular ~50, searchable
  later).
- Selected fonts recorded in site config (extends the §7 meta record in
  `GAPS_AND_SOLUTIONS.md`); the site shell and the editor canvas both emit the
  `<link>` loads.
- `--font-family` values reference the loaded families; deployment transform unchanged.

### Verify

Pick a Google font for the hero → canvas renders it → publish → deployed page loads the
font (network assertion) and renders it.

---

## 4. Theme tokens (site-wide styling)

**Status: implemented** — Base rewritten to consume tokens via `var()` fallback chains
(defaults no longer block inheritance); Theme panel writes a `body { --… }` rule that
the deployment transform preserves whole; instance overrides still win. Verified live
restyle + snapshot round trip in `scripts/verify-parity.mjs`.

### Problem

Every style edit is per-instance. Rebranding a site means touching every component;
Webflow solves this with classes, which we deliberately don't want.

### Solution

- A site-level token set (brand color, accent, radius, base font, spacing scale) stored
  in site config and emitted as `:root { --brand: … }` on both canvas and published shell.
- Components consume tokens as custom-prop defaults (`--background-color:
  var(--brand-surface, #fff)` pattern in Base).
- "Theme" panel in the editor editing those root props — one surface, whole-site
  restyling, still mistakeless.
- Per-instance style-manager edits keep winning over tokens (custom-prop cascade already
  behaves this way: instance inline > token root default).

### Verify

Change brand color in the theme panel → hero and cards restyle together on canvas →
publish → deployed page reflects it; a per-instance override still wins.

---

## 5. Editor ergonomics

**Status: partially implemented** — 5 of 7 checklist items done (undo/redo, hover
states, publish link via site bar, dirty indicator, panel scoping via §11's
`styleParts` host curation); navigator and spacing inputs remain.

### Problem / Solution (checklist)

- [x] Undo/redo — toolbar buttons over GrapesJS UndoManager.
- [ ] Navigator/layer tree — GrapesJS LayerManager mounted in a panel, filtered to
      selectable components (structure stays locked; it's for selection, not rearranging).
- [x] Hover states — `--hover-*` fallback chain in Base `:host(:hover)` + a Hover
      sector in the style manager.
- [ ] Spacing inputs — GrapesJS composite/number field polish for padding/margin
      (linked sides).
- [x] Publish confirmation — covered by the host site bar, which persistently shows the
      live URL next to the publish button.
- [x] Unsaved-changes indicator — dirty flag on the toolbar, cleared on save/publish
      and on artifact load.
- [x] Style panel scoping — solved by §11: `static styleParts.host` declares which
      sector groups a component exposes (per-property `isVisible` functions).

Found and fixed along the way: the styling sidebar overflowed the shell's 600px row and
its z-indexed fields invisibly swallowed clicks on content below the editor — the
sidebar now scrolls (`overflow-y: auto`).

### Verify

Each item lands with a check appended to the ergonomics verify script; undo/redo and
hover round-trip through publish.

---

## 6. Pages + CMS

**Status: designed elsewhere.** Multipage is specced in `GAPS_AND_SOLUTIONS.md` §3/§7
follow-ups (site manifest, page switcher, Worker path routing); collections are the
articles-app plan (MD files, draft/published, list/detail component). This file tracks
them only as editor surfaces: the page switcher in the toolbar and the content (articles)
tab join the editor shell when those land.

---

## 7. SEO and page meta

**Status: implemented** — Page panel (title, description) → `content.page` in the
artifact → shell renders title/description/og tags; verified against the Worker.

### Problem

Published pages have a bare `<title>` (the site name) and no meta description or
social-card tags.

### Solution

- Per-page meta (title, description, OG image once §2 assets exist) stored in site
  config, edited in a small "Page settings" panel.
- Site shell renders the tags; sensible fallbacks (site name, first hero heading).

### Verify

Set title/description → publish → curl the subdomain and assert the tags.

---

## 8. Interactions (constrained presets)

**Status: implemented (v1)** — `animation="fade-up"` preset in Base (IntersectionObserver,
honors `prefers-reduced-motion`), exposed as a select trait on Card/Hero/Image. Attribute
persistence verified; the visual animation itself is not asserted in CI.

### Problem

Webflow's IX2 is a freeform animation timeline; ours must not be.

### Solution

Preset entrance/scroll-reveal animations as component traits (`animation: fade-up |
none`, `--animation-duration`), implemented once in Base with IntersectionObserver,
honoring `prefers-reduced-motion`. No timelines, no arbitrary triggers.

### Verify

Enable fade-up on a card → published page animates on scroll into view; reduced-motion
disables it.

---

## 9. Drag-to-resize

**Status: implemented** — verified by `scripts/verify-parity2.mjs`. Implementation
notes that differ from the plan below:
- GrapesJS binds the resizer's pointer listeners on `document`; our handles live in the
  shell's **shadow root**, so events were retargeted to the host and never matched a
  handler. Fixed by passing `docs: [shadowRoot]` through the resizable options (with a
  `body` expando for GrapesJS's body-class toggle).
- GrapesJS's unit detection bracket-accesses computed style, which fails for custom
  props: enabled axes are **seeded** (`--width: 100%` — semantically identical to the
  Base default) at `component:resize:init`, and disabled axes keep real property keys.
  Resize consequently writes **percent** widths — the responsive-friendlier unit.
- The canvas got 12px canvas-only padding (`canvasCss`, not exported) so full-width
  components never touch the clipped canvas edge where handles were unreachable.

### Problem

No gesture-based sizing. Especially wanted for app-scale components (articles app):
"you may make me 300–1200px wide; my internals reflow."

### Solution

GrapesJS's built-in Resizer, retargeted at the contract: `resizable` on component types
with `keyWidth: '--width'` / `keyHeight: '--height'`, so the drag gesture is just another
writer of the same knobs the style panel edits — style manager stays in sync, deployment
transform already handles the result, and the resizer is **device-aware** (resizing on
Mobile writes into the mobile media query; the §1 per-property split applies).

- Components **opt in per axis with constraints** (`static resize = { width: true,
  height: false, min: 240, max: 1200 }` → handles shown, `minDim`/`maxDim`). Width is the
  safe default; height only where the component handles overflow (prefer min-height
  semantics for text-bearing components).
- Future tier (not now): grid-snap resizing for page rows — spans (4→6 of 12) via a
  `--span` prop the page CSS consumes.
- Do not hand-roll overlay handles; the Resizer already does pointer math, snapping,
  and model updates.

### Verify

Drag a card's right handle → `--width` appears in its rule and the style panel; on
Mobile the write lands in the media query; publish → round trip → deployed page honors it.

---

## 10. Inline text editing

**Status: implemented** — verified by `scripts/verify-parity2.mjs` (double-click →
type → blur commits to the attribute; traits panel, artifact, and deploy all agree).
(Existed pre-shadow-DOM; removed because GrapesJS's RTE cannot
reach into shadow roots, and editing rendered DOM would be overwritten by Lit anyway.)

### Problem

Text can only be changed through the traits panel. Clients expect to double-click text
and type.

### Solution

Inline editing is **attribute writing in disguise** — the commit must go through the
GrapesJS model or export/undo/traits break:

- Components annotate editable text in templates (`data-edit="title"` on the `<h3>`);
  a Base helper wires double-click → `contenteditable` on that node.
- On blur/Enter the component dispatches a `composed: true` custom event
  (`archura:text-edit`, `{ trait, value }`); the controller catches it in the canvas,
  resolves the GrapesJS component for the host, and calls `addAttributes({ [trait]:
  value })`. Model stays authoritative: Lit re-renders from the committed attribute,
  traits panel updates, undo works, dirty flag trips.
- **Plain text only** (commit `innerText`, never HTML — paste cannot smuggle markup;
  formatting stays design-owned via the style panel). This is deliberately not the
  GrapesJS RTE with a formatting toolbar.
- Commit-on-blur avoids fighting Lit re-renders while typing.
- Rejected: restructuring components to put text in light DOM for the native RTE —
  trades the encapsulation model for a convenience this design gets anyway.

### Verify

Double-click the card title, type, blur → canvas text, traits panel, artifact html, and
undo all agree; published page shows the new text.

---

## 11. Part-level styling (select the title, not just the card)

**Status: implemented** — verified by `scripts/verify-parity2.mjs` (drill-down chip,
independent title styling, sector scoping, standalone deploy). **Implementation pivoted
to the `::part()` variant** rejected below, because two platform facts flipped the
trade: `StyleManager.select(cssRule)` targets a `#id::part(name)` rule with zero
property remapping, and the css-shadow-parts cascade makes outer `::part` declarations
beat shadow-tree defaults — so unset knobs preserve author styling with **no generated
consumption CSS at all**. Curation is preserved by a dedicated "Selected Part" sector
(typography-only in v1). `static styleParts` still gates which parts are clickable and
which host groups show (host scoping via per-property `isVisible` functions — the
StyleManager re-derives sector visibility from them natively). Part selection is a
**drill-down**: first click selects the component, a second click enters the part under
the cursor. The Card contract fix landed (internals no longer paint over the host).
The namespaced-props design below is retained as the fallback if part styles ever need
per-breakpoint values (the ::part rule is currently device-global).

Original problem statement and considered design:

### Problem, precisely

Two separate issues observed on Card:

1. **No sub-selection.** Shadow DOM makes internals unselectable (by design), and every
   style-manager write targets the host. Styling the title alone is unreachable.
2. **Contract violation in Card itself**: `.card` paints its own background from
   `--card-bg`, covering the host's `--background-color` — so background edits appear to
   "half work." Component-authoring bug, predates theme tokens; internals must derive
   from the standard contract (or expose their knob in the style manager), never
   shadow it. Fix independently of the feature below, and add a contract lint rule to
   the future SDK validator.

### Solution: virtual part selection over namespaced props

Stay on the same channel — the host's style rule — but let the *property names* carry
the part:

- Components already mark parts (`part="title"`); their CSS consumes **part-scoped
  props**: `.title { color: var(--title-color, inherit); font-size:
  var(--title-font-size, …) }`. Authors curate which parts exist and which knobs each
  part exposes.
- Editor UX: clicking inside a component hit-tests the shadow via `composedPath()`,
  finds the `[part]`, and sets an **active part** on the controller. GrapesJS selection
  stays on the host; the style manager re-maps its sectors to write `--<part>-*`
  properties. A small breadcrumb chip shows `Card › title` with an ✕ to return to the
  whole component.
- Everything downstream is unchanged: writes land in the host's id-scoped rule,
  per-device media queries work, the deployment transform inlines or media-splits as
  usual, round trip and undo work.
- Alternative considered — native `::part()` rules (`#id::part(title) { … }`):
  platform-correct and survives the transform (kept in snapshot.css), but opens *every*
  CSS property on exposed parts rather than author-curated knobs, and needs custom rule
  targeting in the style manager. Namespaced props keep the curation; revisit ::part if
  prop namespacing proliferates.

### Authoring contract: how authors mark what is stylable

One static declaration, mirroring the trait pattern (`static properties` → traits;
`static styleParts` → styling surface):

```js
static styleParts = {
  host:    ['typography', 'spacing', 'dimension', 'decorations', 'hover'],
  title:   ['typography'],
  content: ['typography'],
};
```

- **Editor**: introspected cross-realm like traits; host selection shows the `host`
  groups, an active part shows its groups with properties remapped to `--<part>-*`.
  Host curation solves the §5 "style panel scoping" item for free (e.g. Image drops
  Typography). Default when undeclared: all groups on host, no selectable parts —
  existing components unchanged.
- **Hit-test**: only declared parts are clickable — not declared = not stylable,
  structurally.
- **CSS**: `Base` overrides Lit's `static finalizeStyles()` to *generate* the
  consumption CSS (`[part="title"] { color: var(--title-color, inherit); … }`) from the
  declaration — declaration is implementation; show/respond drift is impossible for
  standard groups. `inherit` fallbacks preserve the cascade: token → host knob → part
  knob.
- **Validator rules (SDK)**: every declared part appears as `part=` in the template;
  internals must not shadow contract props with their own paint (the `.card`/`--card-bg`
  bug as a lint rule).
- v1 groups are coarse (all of Typography or none); per-knob curation
  (`'typography.color'`) is a later extension of the same syntax.

### Verify

Click the card title → chip shows the part → set color/size → only the title changes;
content part styled independently; publish → round trip → deployed page preserves both;
background edit on the host now visibly applies (Card contract fix).

---

## The channel rule (for all future gestures)

Resize and inline text are the first gesture-based editing surfaces. Both write through
the two channels everything else uses: **style rules** (custom props) and **attributes**
(traits). Keep it that way: a new gesture may only write through an existing artifact
channel — the moment it needs its own persistence path, it is breaking the mistakeless
envelope.

---

## Suggested order

1. ~~§2 images/assets~~ · ~~§5 quick wins~~ · ~~§1 responsive~~ · ~~§4 tokens + §3 fonts~~ ·
   ~~§7 SEO~~ · ~~§8 interactions~~ — done (see statuses above)
2. §11 part-level styling — starts with the Card contract fix (user-visible bug), then
   virtual part selection; biggest remaining capability gap
3. §9 drag-to-resize — small phase, mostly Resizer configuration
4. §10 inline text editing — medium phase (Base helper + model bridge)
5. §5 remainder (navigator, spacing inputs, panel scoping) + §1 style-source indicators

After this arc, the fair comparison: can't do a tenth of what Webflow's designer does,
produces equally professional results for the templates it covers, and is usable by
people Webflow filters out — plus agents.
