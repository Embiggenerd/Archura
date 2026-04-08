# Architecture

## Core flow

```text
GrapesJS editor
  -> GrapesJS component tree / project data
  -> normalized builder tree
  -> generated web-component composition
  -> deployable output
```

## Why this folder exists

The older `svedit-builder` experiment proved some editing ideas, but it is not the right center of gravity for a GrapesJS-level visual site builder.

This folder is for the alternate direction where:

- GrapesJS is the assembly shell
- web components are the runtime building blocks
- our own normalized tree is the stable contract

## Important rule

Do not treat raw GrapesJS HTML export as the main source of truth.

Prefer:

- component type
- prop data
- child tree
- template restrictions
- stage restrictions

over:

- plain HTML
- plain CSS

## Main parts

### `manifest`

Defines approved components.

Example responsibilities:

- tag name
- builder type id
- editable props
- style controls
- allowed children

### `runtime`

Wraps GrapesJS.

Example responsibilities:

- register blocks
- register custom component types
- map traits to component props
- enforce editor restrictions

### `normalizer`

Converts GrapesJS project data into our own tree.

Example output:

```json
{
  "type": "Page",
  "children": [
    {
      "type": "Hero",
      "props": {
        "headline": "Move with confidence",
        "theme": "brand-a"
      }
    }
  ]
}
```

### `generator`

Takes the normalized tree and generates runtime output.

That target might be:

- Lit
- Svelte custom elements
- direct custom-element HTML wrappers

We should not lock that choice too early.
