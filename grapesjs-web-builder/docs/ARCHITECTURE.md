# Architecture

## Core flow

```text
Component source (Svelte + Lit)
  -> compiled web components
  -> GrapesJS registration
  -> GrapesJS editing
  -> GrapesJS project data
  -> deployment
```

## Main idea

GrapesJS is not the component implementation source.

Instead:

- components are authored as real web-component-capable source
- GrapesJS edits configured instances of those components
- the saved project contains the actual page composition and edited values

## Component source

Each approved component should exist in both:

- `Svelte`
- `Lit`

This lets us compare:

- authoring ergonomics
- custom-element quality
- styling surface
- GrapesJS integration difficulty

## GrapesJS integration checklist

For each component, confirm all of these exist:

- block definition
- custom component type
- recognition rule
- trait definitions
- trait-to-attribute/property mapping
- allowed child/drop rules
- default content/props
- style manager sectors
- CSS variable hooks
- `::part` hooks where possible
- serialization that preserves the real edited state

## Styling surface

Prefer exposing style control through:

1. attributes/properties for variants and layout
2. CSS custom properties for tokens and adjustable values
3. `::part` for selected internal elements where shadow DOM is used

Avoid requiring GrapesJS to reach into component internals in ad hoc ways.

## Project data

The persisted GrapesJS project should contain the actual thing being edited:

- component type/tag
- configured props/attributes
- child structure
- style values that were changed
- ordering and nesting on the page

We should verify this before adding more abstraction.
