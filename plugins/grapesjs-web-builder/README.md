# GrapesJS Web Builder

This folder is the clean workspace for the `GrapesJS -> normalized tree -> web components` direction.

The idea is:

1. GrapesJS is the visual page-assembly layer.
2. We register approved custom component types in GrapesJS.
3. GrapesJS saves a structured component tree.
4. We normalize that tree into our own schema.
5. We generate deployable web-component composition from that schema.

This avoids making GrapesJS the source of truth for final HTML/CSS and keeps the business logic in our own model.

## Planned layout

- `docs/`
  - notes about the architecture and export path
- `manifest/`
  - component metadata that powers GrapesJS blocks, traits, and style controls
- `runtime/`
  - GrapesJS integration code and custom component registrations
- `normalizer/`
  - conversion from GrapesJS tree/project data into our internal builder tree
- `generator/`
  - code generation for web-component output

## First concrete milestone

Build a tiny GrapesJS runtime that can:

- register 2-3 custom component types
- save a structured tree
- normalize that tree
- print the normalized output

Only after that should we decide whether the generated target is:

- Lit
- Svelte-compiled custom elements
- direct custom-element wrappers
