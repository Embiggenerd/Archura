# Plan: Plasmic-to-Archura Lit Compiler

## 1. Why we are doing this

Archura is good at letting a client edit the content and approved styling of a
known Lit component, but it deliberately does not let that client compose a new
page structure. Plasmic already has the mature visual canvas needed to create
those structures: nested components, Flexbox, Grid, free positioning, variants,
responsive rules, and reusable components.

The shortest path is therefore to give the two systems separate jobs:

```text
Plasmic
visual template and component authoring
        ↓
Archura compiler target
        ↓
Lit custom elements + current Archura registry definitions
        ↓
Existing Archura editor
content and approved styling only
```

The compiled result must be native Archura input, not React code that Archura
has to interpret. A reusable Plasmic component becomes a Lit custom element
extending Archura's existing `Base`. A Plasmic page becomes a Lit page element
extending Archura's existing `PageBase` and composing the generated component
elements. The compiler also emits the thin `ArchuraComponentDefinition` records
and page `uses` lists that the editor already accepts.

This preserves the intended permissions boundary:

- The Plasmic designer may use the full trusted CSS needed to create a template.
- The generated component exposes only selected parts and existing Archura CSS
  custom properties to the Archura client.
- The Archura client can edit traits, inline text, exposed style parts, responsive
  values, and resizing using the editor that already exists.
- Structural changes return to Plasmic. Archura continues to lock page structure.

### Non-negotiable constraint

Do not modify `archura-editor` in this implementation. In particular, do not add
an Archura semantic document, template importer, command bus, new artifact
version, new layout model, or new manifest consumer. Use these existing contracts:

- `Base` and its CSS-variable styling behavior.
- `PageBase` and its light-DOM page expansion behavior.
- `static properties`, `static styleParts`, and optional `static resize`.
- `ArchuraComponentDefinition`, including a page definition's `uses`.
- The host-provided `components` registry passed to `ArchuraEditorController`.

The implementation belongs in the Plasmic fork/separate template editor and its
test harness. Archura is an unchanged compatibility target.

### Success criteria

The first implementation is complete when one Plasmic project containing a
reusable card and a responsive landing page can be exported and:

1. Produces browser-loadable ESM Lit modules with no React runtime dependency.
2. Produces valid current-format Archura component and page definitions.
3. Opens as a fresh page in the unchanged Archura editor.
4. Preserves the Plasmic page's Flex/Grid/free-positioned base layout and its
   tablet/mobile presentation.
5. Lets Archura edit generated string, number, boolean, choice, and image traits.
6. Lets Archura select named internal parts and apply the editor's current
   real-CSS-property controls through `#id::part(name)` rules.
7. Preserves trusted Plasmic CSS that is not exposed to Archura.
8. Saves and reloads through Archura without losing the generated composition or
   the client's edits.
9. Reports a compiler error for unsupported dynamic behavior instead of silently
   removing it.
10. Requires no source change under `archura-editor/`.

## 2. Summary of the implementation plan

Add a dedicated Archura exporter beside Plasmic's existing web exporter. Reuse
Plasmic's existing model traversal and style extraction concepts, but do not
change the normal React exporter or add Archura fields to its public schema.

The exporter will create one deterministic bundle:

```text
ArchuraExportBundle
├── generated component modules
│   └── classes extending Archura Base
├── generated page modules
│   └── classes extending Archura PageBase
├── registry definitions
│   ├── kind: component
│   └── kind: page + uses
└── diagnostics
```

The implementation proceeds in this order:

1. Establish fixtures and prove the unchanged Archura page-style/load boundary.
2. Add a small Plasmic-to-Archura intermediate representation and diagnostics.
3. Compile reusable Plasmic components into `Base` subclasses.
4. Compile Plasmic pages into `PageBase` subclasses and emit registry definitions.
5. Add an explicit “Export to Archura” action to the separate Plasmic editor.
6. Run the generated bundle through an integration harness using the unchanged
   Archura editor.

### Initial supported subset

Support only what the first real template requires:

- Plasmic plain components and pages.
- Safe HTML elements and static attributes.
- Static text and direct bindings to component props.
- String, number, boolean, enum/choice, href, and image props.
- Canonical all-lowercase generated prop names, used identically for the Lit
  property, observed HTML attribute, GrapesJS trait, binding, and `data-edit`.
- Native named slots and default slot content.
- Base styles, Flexbox, Grid, and absolute/free positioning.
- Hover/focus selectors that can be represented as CSS.
- Plasmic screen variants configured to Archura's current `991px` tablet and
  `767px` mobile breakpoints.
- Boolean and single-choice component variants that compile to reflected
  attributes and CSS selectors.
- Composition of other generated Plasmic components.

Reject for this implementation:

- Arbitrary JavaScript or dynamic expressions beyond a direct prop reference.
- React-only code components.
- React context, hooks, data providers, and server queries.
- Plasmic runtime state and interactions without a direct static CSS equivalent.
- Repetition and conditional visibility based on runtime data.
- Scripts, inline event-handler attributes, and unapproved embeds.
- Multi-choice or combined variants unless a fixture proves they are required.
- Bidirectional synchronization from Archura back to Plasmic.
- Automatic updates of existing Archura instances when a Plasmic design changes.
- Native web-component registration inside Plasmic Studio. A generic design-time
  bridge for existing Archura elements is a later, separate increment.

### Styling rule

Preserve the designer's complete supported Plasmic CSS as trusted static CSS.
Treat the generated component host and its named internal parts differently.

For `:host`, properties covered by Archura's existing host styling contract must
retain the existing custom-property control with the Plasmic value as fallback:

```css
/* Plasmic */
:host {
  padding: 32px;
  color: #334155;
}

/* Generated Lit CSS */
:host {
  padding: var(--padding, 32px);
  color: var(--color, #334155);
}
```

This rewrite is required because generated component styles follow `Base.styles`
in the shadow stylesheet. A plain generated `:host { padding: 32px }` would win
over `Base`'s `padding: var(--padding, 1.5rem)` and make Archura's host padding
control ineffective.

For named internal nodes, leave the trusted Plasmic declarations plain:

```css
.title {
  color: #334155;
  font-size: 42px;
  filter: drop-shadow(0 2px 4px #0003);
}
```

Emit `part="title"` and the corresponding `static styleParts` entry. The editor
styles an active part with real declarations such as
`#instance::part(title) { color: ... }`; those outer `::part()` declarations
override the shadow-internal defaults in the cascade. Do not rewrite internal
part declarations to `var(--color, ...)`: host custom properties inherit into
the shadow tree and would unintentionally make a host color edit override the
designer's explicit part colors.

Plasmic hover/focus rules on internal nodes also remain trusted static
pseudo-selector CSS. Archura's `--hover-*` controls are host-level controls in
the current editor, not an editing mechanism for internal part states.

## 3. Actual implementation plan

### Step 0: record the compatibility boundary before coding

In the Plasmic checkout, inspect and record the exact current source locations
before editing. The current upstream seams are:

- `platform/wab/src/wab/shared/web-exporter/component-exporter.ts`
- `platform/wab/src/wab/shared/web-exporter/schema.ts`
- `platform/wab/src/wab/shared/web-exporter/component-exporter.spec.ts`

The current exporter already dispatches over `TplTag`, `TplComponent`, and
`TplSlot`, extracts base and variant styles, and ends by putting
`tplToHtml(component.tplTree, site)` into `baseVariantTplTree`. Reuse its helpers
where they are already exported. If a useful helper is private, export that
helper with its existing behavior and regression tests; do not refactor the
normal exporter.

Also inspect these unchanged Archura contracts:

- `archura-editor/src/components/base/Base.js`
- `archura-editor/src/components/base/PageBase.js`
- `archura-editor/src/components/cards/Card.js`
- `archura-editor/src/components/pages/Landing.js`
- `archura-editor/src/editor/types.ts`
- `ArchuraEditorController.#registerTraits()`
- `ArchuraEditorController.#expandPage()`
- `ArchuraEditorController.#lockStructure()`

Do not edit them.

Create a Plasmic fixture project/model with:

- `PricingCard`: string `name`, string `price`, boolean `featured`, a named
  `title` node, a named `price` node, and a `features` slot.
- `Landing`: a vertical page containing a hero, a three-card Grid, and one
  free-positioned decorative element.
- Desktop, tablet (`991px`), and mobile (`767px`) layout differences.

Before building the complete exporter, make a hand-written generated fixture in
the Plasmic integration-test area and load it through Archura's public
configuration. This spike must answer one question without changing Archura:

> Does a `<style>` element emitted inside a `PageBase` light-DOM render survive
> page expansion, GrapesJS parsing, save, reload, and published snapshot output?

If it survives, page modules may emit scoped page CSS in a `<style>` child. If it
does not survive, do not patch Archura. Keep page wrappers' base styles inline
and compile responsive/styled regions into generated `Base` section components,
where `static styles` works normally.

Verification:

- The hand-written fixture loads in Archura.
- Generated leaf elements are selectable.
- Non-Archura layout wrappers are locked and unselectable.
- One trait and one part style can be changed, saved, and reloaded.
- The page-style spike has a recorded pass/fail result and selected fallback.

### Step 1: define the Archura export bundle and diagnostics

Add a focused directory in the Plasmic fork:

```text
platform/wab/src/wab/shared/archura-exporter/
├── schema.ts
├── component-exporter.ts
├── lit-emitter.ts
├── style-contract.ts
├── index.ts
└── component-exporter.spec.ts
```

Keep the types small:

```ts
type ArchuraExportBundle = {
  files: Array<{
    path: string;
    source: string;
  }>;
  definitions: ArchuraGeneratedDefinition[];
  diagnostics: ArchuraExportDiagnostic[];
};

type ArchuraGeneratedDefinition = {
  kind: "component" | "page";
  path: string[];
  tagName: string;
  modulePath: string;
  label: string;
  uses?: string[][];
};

type ArchuraExportDiagnostic = {
  severity: "error" | "warning";
  code: string;
  componentUuid: string;
  nodeUuid?: string;
  message: string;
};
```

Use one small internal node representation shared by the two emitters. It needs
only:

- Stable source UUID.
- Safe tag or generated component reference.
- Static attributes.
- Static text, direct prop binding, or children.
- Named slot information.
- Base styles and supported variant overrides.
- Named-part metadata.

Do not model future Archura documents, data binding, agent operations, actions,
or template migrations.

Generate deterministic identities:

- Custom-element tag: `archura-<project-slug>-<component-slug>-<short-uuid>`.
- JavaScript class name: sanitized component name plus the same short UUID when
  needed to avoid collisions.
- Registry path: `["plasmic", "<project-id>", "<component-uuid>"]`.
- File path: derived from the stable tag, not only the mutable display name.

Fail the export when two generated identities collide.

Add diagnostics for at least:

- `UNSUPPORTED_COMPONENT_TYPE`
- `UNSUPPORTED_TAG`
- `UNSUPPORTED_EXPRESSION`
- `UNSUPPORTED_STATE`
- `UNSUPPORTED_VARIANT`
- `UNSUPPORTED_CODE_COMPONENT`
- `UNRESOLVED_COMPONENT_REFERENCE`
- `INVALID_CUSTOM_ELEMENT_NAME`
- `PROP_NAME_COLLISION`

Verification:

- Snapshot tests prove deterministic output.
- Renaming a component changes its label but does not break its UUID-derived
  registry identity.
- Every unsupported fixture produces an error naming the source component and
  node.

### Step 2: traverse Plasmic into the minimal Archura representation

Implement a dispatcher parallel to the existing web exporter:

```ts
buildArchuraNode(tpl, context)
  ├── TplTag       → native element node
  ├── TplComponent → generated component reference
  └── TplSlot      → native slot node
```

For `TplTag`:

- Allow safe structural and content tags required by the fixture.
- Reject `script`, inline `on*` attributes, and unsupported embeds.
- Preserve static attributes after removing Plasmic-only editor metadata.
- Preserve static raw text.
- Recognize only a direct component-prop reference as dynamic content. Convert it
  to a Lit property expression and attach `data-edit="<propName>"` when it is a
  text-editable element.
- Assign a deterministic generated selector to every node that has styles.
- If the Plasmic node has a designer-visible name, sanitize that name into a
  `part` value and mark it as an Archura-editable part.

For `TplSlot`:

- Emit `<slot>` for the default slot or `<slot name="...">` for a named slot.
- Preserve static fallback children.
- Include the slot's generated component dependency in the registry only when a
  concrete generated component is actually referenced.

For `TplComponent`:

- Resolve another plain/page Plasmic component to its generated custom-element
  tag.
- Map statically known arguments to attributes or Lit property assignments.
- Map slot arguments to children with `slot="..."`.
- Reject React code components in the first implementation.
- Record the dependency so page `uses` can be emitted transitively without
  duplicates.

For props:

- Take Plasmic's existing valid identifier from `paramToVarName()` and lowercase
  it before emitting code. For example, `priceLabel` becomes `pricelabel`. Keep
  a source-name-to-generated-name map and use the generated name consistently
  for the Lit property key, default observed attribute, GrapesJS trait, template
  binding, reflected variant selector, and `data-edit` value. Do not preserve a
  camelCase property key with a separate lowercase attribute name: the current
  Archura trait bridge uses the property/trait name as the attribute key, while
  HTML serialization lowercases attributes.
- Detect normalization collisions such as `priceLabel` and `pricelabel`; stop
  export with `PROP_NAME_COLLISION` rather than renaming one implicitly.
- Map text/string/href/image to `String`.
- Map numeric props to `Number`.
- Map boolean props to `Boolean`.
- Map enum props to `String` plus Archura's existing `options` array.
- Map image props to `String` plus `asset: true`.
- Emit defaults in the generated constructor.
- Reflect boolean and enum variant props when generated CSS selects them by
  attribute.

For variants:

- Base settings become the default template and CSS.
- Boolean and single-choice component variants become properties and reflected
  attributes.
- Hover/focus element variants become static pseudo-selector CSS.
- Screen variants become media queries only for the configured `991px` and
  `767px` breakpoints.
- Reject variant combinations the implementation cannot represent faithfully.

Verification:

- Unit fixtures cover each supported Tpl node type.
- A nested generated component keeps its props and slotted children.
- A direct prop-bound heading changes when the generated custom-element property
  changes.
- A multi-word source prop such as `priceLabel` compiles to `pricelabel` in
  `static properties`, the Lit expression, the HTML attribute, and `data-edit`.
- Two source prop names that normalize to the same lowercase name stop export
  with `PROP_NAME_COLLISION`.
- An arbitrary custom expression stops export with `UNSUPPORTED_EXPRESSION`.

### Step 3: compile trusted CSS, host controls, and Archura-editable parts

Put the exact current Archura style-variable mapping in
`style-contract.ts`. The mapping applies to generated `:host` declarations only.
At minimum it must match the properties consumed through custom-property
fallbacks by `Base.styles`; include an additional host property only when the
current StyleManager writes the same custom property and the generated `:host`
rule consumes it. Group host capabilities using Archura's current groups:

- `typography`
- `spacing`
- `dimension`
- `decorations`
- `hover`
- `flex`

For every generated node:

1. Preserve its supported Plasmic CSS declarations.
2. For generated `:host` declarations covered by the host contract, emit the
   existing Archura custom property with the Plasmic value as fallback.
3. Leave generated `:host` declarations outside that contract as trusted static
   CSS.
4. Leave every internal node's declarations as trusted plain CSS, including
   declarations on named parts.
5. If an internal node is named, infer its descriptive Archura groups, emit
   `part="<name>"`, and add it to `static styleParts`. The current editor uses
   the part key to make the node selectable and writes real CSS properties into
   the outer `::part()` rule.
6. Keep internal hover/focus variants as static pseudo-selector CSS; do not map
   them to the host's `--hover-*` variables.

Do not expose a property merely because Plasmic supports it. Exposure is limited
to the current Archura contract. Never silently drop a declaration: preserve it
as trusted static CSS or emit a diagnostic if it cannot be represented safely.

Use selectors scoped inside the generated component's Shadow DOM, based on
stable generated node selectors. Do not use global selectors for reusable
components.

Verification:

- Flex, Grid, and free-positioned fixture nodes have the expected computed styles.
- A Plasmic host `padding: 32px` compiles to
  `:host { padding: var(--padding, 32px) }`, and setting host `--padding`
  overrides it.
- A named title compiles to `part="title"` plus its `static styleParts` entry,
  while its Plasmic `color` and `font-size` remain plain declarations.
- Setting host `--color` does not change a named part with an explicit Plasmic
  color.
- An outer `#instance::part(title) { color: ... }` rule overrides the
  shadow-internal Plasmic color.
- A supported static property such as `filter` remains visually present.
- An internal Plasmic `:hover` rule remains static and is not rewritten to
  `--hover-*`.
- Tablet and mobile computed styles activate at `991px` and `767px`.

### Step 4: emit reusable Lit component modules

Implement `emitLitComponent()` for Plasmic plain components.

Each module must:

- Import `html` and `css` from Lit.
- Import `Base` from the compiler option supplied by the integration host.
- Extend `Base`, not bare `LitElement`.
- Define `static grapesTagName`.
- Define own `static properties` using only the canonical all-lowercase generated
  prop names.
- Define `static styleParts` when named editable parts exist.
- Define `static resize` only when the export configuration explicitly enables
  it; do not infer resize permissions from arbitrary Plasmic dimensions.
- Include `Base.styles` before generated styles.
- Set prop defaults in the constructor.
- Render the compiled Lit template, native slots, `part` values, and `data-edit`
  markers.
- Guard `customElements.define()` so loading the module twice is harmless.

The compiler takes explicit import specifiers for `Base`, `PageBase`, and Lit.
Do not infer deployment URLs and do not embed arbitrary module URLs from the
Plasmic document. The integration host is responsible for bundling or replacing
those trusted import specifiers when it publishes the generated files.

Run every generated module through the repository's existing formatter and a
syntax/build check. Do not compare only source strings.

Verification:

- The generated module builds as ESM.
- A browser can import it and create the custom element.
- Defaults render before any attributes are provided.
- String, number, boolean, enum, and image values update through attributes or
  properties as Lit expects.
- Native slots render assigned and fallback content.
- No generated module imports React or a Plasmic runtime.

### Step 5: emit page modules and current Archura registry definitions

Implement `emitLitPage()` for Plasmic pages.

Each page module must:

- Import `html` from Lit.
- Import `PageBase` from the trusted compiler option.
- Import or otherwise ensure registration of every generated component it uses.
- Extend `PageBase`.
- Define `static grapesTagName`.
- Render only the generated page composition.
- Guard `customElements.define()`.
- Apply the page-style strategy proven in Step 0.

Emit one current-format definition for every generated reusable component:

```ts
{
  kind: "component",
  path,
  tagName,
  moduleUrl,
  label
}
```

Emit one current-format definition for every generated page:

```ts
{
  kind: "page",
  path,
  tagName,
  moduleUrl,
  label,
  uses
}
```

`uses` must contain every selectable generated leaf component present anywhere
in the page, transitively, exactly once. Do not include pure layout wrappers.
Emit module paths in the bundle; the integration host converts those paths into
served `moduleUrl` values before passing the registry to Archura.

Verification:

- The page's dependency imports and `uses` agree.
- Every `archura-*` element in the rendered page is backed by one definition.
- The unchanged Archura editor registers traits for all generated leaf elements.
- Page wrappers remain structure-locked.
- Opening a fresh generated page, saving it, and reopening the artifact preserves
  its composition.

### Step 6: expose an explicit Plasmic export action

After the pure compiler and tests pass, add one action to the separate Plasmic
editor:

```text
Export to Archura
```

Wire it beside the existing component/project export UI rather than altering the
normal React export path. The action:

1. Selects one Plasmic page and its reachable plain-component dependencies.
2. Runs the Archura exporter.
3. Blocks the download when any error diagnostic exists.
4. Shows warnings with component and node names.
5. Downloads or hands the deterministic `ArchuraExportBundle` to the separate
   template-editor host.

For the first implementation, a JSON bundle containing file paths, source
strings, definitions, and diagnostics is sufficient. Do not add storage,
deployment, template version upgrades, or publication orchestration to the
compiler task.

Verification:

- The fixture page exports from the visible action.
- An unsupported React code component prevents export and produces an actionable
  message.
- Repeating the export without source changes produces byte-identical generated
  source and definitions.
- The normal Plasmic exporter remains unchanged and its existing tests pass.

### Step 7: verify against the unchanged Archura editor

Create the integration harness outside `archura-editor`. It may import/build the
existing editor as a dependency, but it must not patch its source.

The harness should:

1. Compile the Plasmic fixture bundle.
2. Materialize or serve its generated ESM files.
3. Convert every generated `modulePath` to a trusted local test URL stored in a
   `moduleUrl` field.
4. Assert that the final definitions contain `moduleUrl` (not `modulePath`), then
   pass them through Archura's existing `components` configuration.
5. Open the generated page as a fresh Archura editing target.
6. Edit the generated multi-word `pricelabel` trait, one host style, one part
   style, and one mobile override.
7. Save, reload from the resulting current artifact, and compare the rendered
   state.

Automate these assertions:

- No source file under `archura-editor/` changed.
- The generated page opens without module errors.
- Plasmic Flex/Grid/free-positioned base layout has the expected computed styles.
- The mobile layout activates at the expected preview width.
- Component hosts are selectable; structural wrappers cannot be moved or removed.
- Trait editing updates the generated Lit property.
- After save/reload, the trait panel and rendered component both retain the
  edited `pricelabel` value; the serialized HTML contains `pricelabel`, not
  `priceLabel`.
- Part styling overrides the plain shadow-internal Plasmic declaration without
  removing other trusted static CSS.
- Host custom-property edits override generated `:host` fallbacks without
  leaking through and replacing explicit internal-part values.
- Save/reload preserves both the generated defaults and the Archura overrides.
- The generated dependency graph contains no React or Plasmic runtime package.

Run the existing Plasmic web-exporter tests as regression coverage and the
existing Archura verification suite without modifying it. Record any
pre-existing failures separately; do not repair unrelated code during this task.

### Completion gate and deferred work

Stop after the fixture passes the full compiler-to-Archura round trip. Do not
continue into the following deferred work without a separate decision:

- An `ArchuraTemplate` semantic JSON format.
- Changes to Archura's canonical artifact.
- Archura-side structural composition.
- A semantic command/agent layer.
- Template-instance upgrade or merge behavior.
- A native `registerWebComponent()` feature in Plasmic Studio.
- A generic React bridge for preexisting Archura components.
- Plasmic data queries, runtime interactions, or arbitrary expression execution.
- Storage, deployment, or production publication of generated bundles.

The delivered result should prove one narrow proposition: Plasmic can serve as
the visual compiler frontend for real Lit components and page modules that the
current Archura editor can load and style without being changed.
