# Editor Roadmap

This document is about the `user-facing page and component editor`.

It is intentionally narrower than the broader long-term system plan.

Current focus:

- GrapesJS as the editor experience
- Lit as the active component implementation path
- proving that Lit-backed components can be edited with a native-feeling GrapesJS workflow

Important clarification:

- `native-feeling GrapesJS workflow` means support for the full GrapesJS styling universe exposed through `StyleManager.getBuiltInAll()`
- it does **not** mean support for only a small hand-picked subset of custom component props

Out of scope for this document for now:

- agent-facing orchestration
- templates/stages/policies
- multi-provider execution
- server-side agent observation
- free-form class addition and arbitrary global CSS selector authoring
- complex animations, transitions, and advanced pseudo-element styling that rely on external CSS not pre-wired into the component library

Those can come later.

## Goal

The goal is not just to render Lit components inside GrapesJS.

The goal is:

`A user should be able to build pages and components with Lit-backed web components without the experience feeling limited compared to using GrapesJS directly.`

That means:

- insert components through GrapesJS blocks
- edit content/config through GrapesJS traits
- edit the full GrapesJS styling vocabulary through GrapesJS style controls
- prefer editing meaningful UI pieces as their own components rather than deeply targeting internal sub-elements
- use `::part(...)` only as a secondary escape hatch, not the primary long-term composition strategy
- save and reload without losing edits
- export/embed the result cleanly

## Current Implementation Decision

We are proceeding with this bridge strategy:

1. register Lit web components as GrapesJS custom component types
2. persist editing state through GrapesJS project JSON
3. let GrapesJS edit the component host
4. bridge host edits into Shadow DOM primarily through CSS custom properties
5. use `::part(...)` as the secondary styling bridge for internal regions

This means:

- GrapesJS is the editor-facing source of changes
- GrapesJS project JSON is the persisted editing artifact
- Lit web components are the deployable runtime units
- CSS custom properties are the first-line Shadow DOM bridge
- `::part(...)` is the second-line Shadow DOM bridge
- meaningful sub-elements like buttons should become their own editable components rather than being styled only as internals of larger components
- we will continue with `tests -> implementation` and only extract a shared component contract after repeated working patterns emerge
- for the supported editing surface, host-level styles and attributes restored from GrapesJS project JSON should be enough for Lit components to round-trip without extra persistence machinery

## Current State

We have already proven:

- Lit custom elements can render in the GrapesJS canvas
- GrapesJS can drive Lit attributes/props
- GrapesJS can persist host CSS variable styling
- GrapesJS can persist `::part(...)` styling
- we can validate component attribute contracts with tests

## Main Gap

The main remaining gap is no longer:

- “Can Lit work in GrapesJS?”

The main gap is:

- “Can Lit-backed components be edited, styled, saved, reloaded, and exported in a way that feels native to GrapesJS?”

For this project, `native to GrapesJS` explicitly means:

- if GrapesJS exposes a styling control through `StyleManager.getBuiltInAll()`, the component system should have a real persisted and deployable path for that styling change
- success is not limited to a few explicit component attributes such as `surface`, `accent`, or `space-y`
- but we are not targeting arbitrary free-form class systems or arbitrary global selector authoring as part of that path
- and for the supported editing surface, save/load should work by restoring host-level state from GrapesJS project JSON rather than requiring extra custom persistence layers

## Definition Of Native Enough

A Lit-backed component is native enough when:

1. all intended edits can be performed through GrapesJS-native UI surfaces
2. GrapesJS project data fully captures those edits
3. GrapesJS CSS output fully captures the style changes
4. reload reproduces the same visual result
5. export/embed does not require special-case manual repair

And more specifically:

6. the component system can absorb the full GrapesJS styling universe, not just a small custom property subset
7. the supported path should be built primarily on host styles -> CSS custom properties -> shadow DOM consumption, with `::part(...)` for targeted internal styling
8. larger components should trend toward composition of editable subcomponents rather than relying on deep internal style targeting
9. for the supported editing surface, round-tripping should come from GrapesJS project JSON restoring host-level state, not from an extra persistence format

## Testing Strategy

We should drive this with tests at four levels.

### 1. Contract Tests

Purpose:

- verify the component exposes the intended public editing contract

Examples:

- reflected attributes exist
- CSS custom properties are part of the contract
- exposed `part` names exist

Current status:

- started
- Hero attribute contract is tested

### 2. GrapesJS State Tests

Purpose:

- verify GrapesJS stores the correct state after editing

Examples:

- changing a trait updates project data
- changing host styling updates CSS/project state
- changing `::part(...)` styling creates the expected CSS rules
- GrapesJS built-in styling properties from `StyleManager.getBuiltInAll()` have a persisted path
- loading from saved project data restores the same editor state

### 3. Runtime Rendering Tests

Purpose:

- verify saved state actually renders correctly in a browser

Examples:

- host CSS vars visually apply
- `::part(headline)` rules visually apply
- spacing/height/typography match expected behavior
- GrapesJS built-in styling properties visibly change the rendered component as expected
- the custom element upgrades correctly in the GrapesJS iframe

Suggested tool:

- Playwright

### 3a. Lit Unit / Component Tests

Purpose:

- verify Lit components consume host-level styles, CSS custom properties, and exposed parts correctly in isolation

Why this matters:

- this is the fastest feedback loop for Shadow DOM styling compliance
- these tests mirror what GrapesJS actually does to the host element
- if the component does not react correctly here, editor persistence will not save us later

Examples:

- render a Lit component in a real browser test
- set host-level styles or CSS vars on the component host
- assert computed styles on the host or inside the shadow root
- assert exposed `part` hooks exist where needed

Suggested tools:

- `@web/test-runner`
- Playwright component/browser testing

### 3b. GrapesJS Integration Tests

Purpose:

- verify the full editor + Lit interaction works correctly

Why this matters:

- these tests prove that GrapesJS model/view changes actually reach the Lit component in the editor canvas
- this is the closest test layer to the actual user-facing editing experience

Examples:

- register the custom GrapesJS type
- add the component through a block or model insertion
- apply style changes through the GrapesJS model or editor APIs
- assert the host and visible shadow content update correctly

Suggested tools:

- Playwright

### 3c. Full Persistence Round-Trip Tests

Purpose:

- verify save -> load -> render works end to end with GrapesJS project JSON

Why this matters:

- this is the long-term reliability layer for the chosen persistence model
- it proves that the supported editing surface can round-trip without extra persistence machinery

Examples:

- edit a component in the editor
- capture `editor.getProjectData()`
- verify the saved JSON includes the expected host-level style/attribute state
- reload with `editor.loadProjectData(...)`
- assert the same visual result after reload

### 4. UX Parity Tests

Purpose:

- verify the Lit layer is not forcing users out of the normal GrapesJS workflow

Examples:

- target edits can be done from GrapesJS-native controls
- no required edit path depends on external helper UI
- the editing flow feels the same as normal GrapesJS usage

## Practical Next Steps

1. Keep the existing contract tests.
2. Add GrapesJS state tests for trait edits, host style edits, and `::part(...)` edits.
3. Add browser/runtime tests for rendered results.
4. Expand the Lit component library’s CSS custom property surface so more GrapesJS styling controls have a real shadow-DOM path.
5. Use `::part(...)` to expose targeted internal styling hooks where CSS vars are not enough.
6. Break meaningful internal UI pieces into their own editable components where that scales better than deep targeting.
7. Continue the `test -> implementation` loop and defer formal shared-contract design until it emerges from multiple working components.
8. Move more editing controls into GrapesJS-native surfaces.
9. Keep helper/debug UI only for internal verification.
10. Remove helper-only editing paths once parity is proven.

## Important Principle

The app shell is allowed.

What is not allowed is:

- a helper layer that makes the editor less capable than GrapesJS itself

So the right standard is not:

- “no app around GrapesJS”

It is:

- “the app shell must not reduce the native GrapesJS editing surface”

## Current Routes

- `/`
  - instrumented/debug view
- `/demo`
  - cleaner comparison view

These are useful while closing the gap:

- `/`
  - helps us inspect project data, CSS, and runtime behavior
- `/demo`
  - helps us judge whether the editing experience feels close to a normal GrapesJS workflow
