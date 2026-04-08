# GrapesJS Web Builder

This is the new root-level workspace for the `real web components + GrapesJS` direction.

The simplified MVP model is:

1. Build each approved component in both `Svelte` and `Lit`.
2. Compile them to native web components.
3. Register those web components in GrapesJS.
4. Expose editable props, traits, blocks, and styling hooks.
5. Save GrapesJS project data as the actual edited page state.
6. Deploy the configured composition.

This avoids making GrapesJS generate framework source and avoids adding a normalization layer too early.

Important clarification:

- `native GrapesJS editing experience` means support for the full GrapesJS styling universe, not just a small set of custom component props
- in practice, the target styling vocabulary is what GrapesJS exposes through `StyleManager.getBuiltInAll()`

Current decisions:

- persist editing state through GrapesJS project JSON
- use GrapesJS custom component types as the editor integration point
- bridge Shadow DOM styling primarily through CSS custom properties
- use `::part(...)` as the secondary styling bridge
- for the supported editing surface, host-level styles/attributes restored from GrapesJS project JSON should be enough for Lit components to round-trip without extra persistence machinery
- prefer composition of editable subcomponents over deep internal targeting
- meaningful pieces like buttons should become their own editable components
- continue with `test -> implementation` before extracting a shared contract
- keep free-form class systems and arbitrary global selector authoring out of scope for now
- keep complex external animation/pseudo-element styling out of scope for now

Testing strategy in practice:

- Lit/browser component tests for host-style and Shadow DOM style consumption
- GrapesJS integration tests for editor + Lit interaction
- full save/load round-trip tests using GrapesJS project JSON

See also:

- [Editor Roadmap](/Users/code123/shurale/grapesjs-web-builder/docs/EDITOR_ROADMAP.md)

## Folder layout

- `docs/`
  - architecture notes and checklists
- `component-source/`
  - source components in both Svelte and Lit
- `grapesjs-integration/`
  - GrapesJS block, trait, component-type, and style-hook integration
- `project-data/`
  - examples of the saved GrapesJS project data we expect to persist
- `example-app/`
  - a minimal SvelteKit shell with two routes:
  - `/`
    - instrumented/debug view with saved-state and runtime inspection
  - `/demo`
    - cleaner comparison view with much less helper UI layered on top of GrapesJS

## Immediate goal

Prove one vertical slice:

- one `Hero` component in Svelte and Lit
- one GrapesJS block for it
- traits that edit real component attributes/properties
- style hooks that can grow toward the full GrapesJS styling universe through CSS vars and `::part(...)`
- saved project data that matches the edited instance

Implemented scaffold:

- [Hero block and component registration](/Users/code123/shurale/grapesjs-web-builder/grapesjs-integration/register-hero.ts)
- [Hero integration definition](/Users/code123/shurale/grapesjs-web-builder/grapesjs-integration/hero-definition.ts)
- [Sample saved project data](/Users/code123/shurale/grapesjs-web-builder/project-data/hero-page.sample.json)
- [Instrumented route](/Users/code123/shurale/grapesjs-web-builder/example-app/src/routes/+page.svelte)
- [Demo route](/Users/code123/shurale/grapesjs-web-builder/example-app/src/routes/demo/+page.svelte)
