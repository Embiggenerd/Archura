# GrapesJS Integration

This folder is for the editor-side integration code.

For the broader user-facing editor plan, see:

- [Editor Roadmap](/Users/code123/shurale/grapesjs-web-builder/docs/EDITOR_ROADMAP.md)

For each component we should define:

- block config
- component type config
- trait list
- style sectors
- recognition rules
- serialization checks

## Do not miss

- `blocks`
  - how components enter the canvas
- `components`
  - GrapesJS model/view definition
- `traits`
  - editable props and attribute/property mapping
- `style-manager`
  - token and style controls
- `selectors`
  - if any external CSS hooks are needed
- `droppable/draggable rules`
  - so templates stay constrained
- `project serialization`
  - verify saved project data contains the actual edited values

## Styling strategy

Use, in order of preference:

1. attributes/properties
2. CSS custom properties
3. `::part`

If a component uses shadow DOM, `::part` and CSS variables should be the main hooks GrapesJS edits.

Current scope decisions:

- persist editor state through GrapesJS project JSON
- let GrapesJS edit the component host
- route shadow styling primarily through CSS custom properties
- use `::part(...)` for targeted internal regions
- for the supported editing surface, host-level styles and attributes restored from GrapesJS project JSON should be enough for component round-tripping
- prefer composition of editable subcomponents over deep internal targeting
- meaningful internal pieces should become their own GrapesJS-editable components when possible
- continue with `test -> implementation` before extracting a shared styling contract
- do not depend on free-form class systems or arbitrary global selectors in the current plan
- do not target complex external animation/pseudo-element styling in the current plan

Recommended test layers:

1. Lit/browser component tests
   - verify host styles, CSS vars, and exposed parts are consumed correctly
2. GrapesJS integration tests
   - verify editor-side model/view changes reach the Lit component correctly
3. save/load round-trip tests
   - verify GrapesJS project JSON restores the same host-level state and visible rendering
