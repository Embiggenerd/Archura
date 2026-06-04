# Artifact Model

This document defines the output model for the editor when the goal is:

- edit a component visually in GrapesJS
- save the edited result in a reusable format
- let other systems decide what to do with that saved result

The editor is the authoring tool.

The saved artifact is the durable output.

Different consumers can turn that artifact into embeds, deployment bundles, package outputs, or CMS previews.

In the `archura` layout:

- `component-source/` contains authored component implementations
- `component-data/canonical/` contains canonical saved artifacts
- `component-data/exported/<target>/` contains derived export output

## Two-Layer Model

We use a two-layer model:

1. the editor saves a canonical JSON artifact
2. exporters generate consumer-specific outputs from that artifact

This keeps the editor generic and avoids coupling the saved result to one deployment path.

## Canonical Artifact

The canonical artifact is the source of truth.

It should contain:

- content
- serialized HTML snapshot
- GrapesJS CSS
- metadata
- optional typed config

Example:

```json
{
  "schemaVersion": 1,
  "id": "hero-home-v1",
  "type": "component-instance",
  "content": {},
  "snapshot": {
    "html": "<builder-hero-lit headline=\"Move with confidence\"></builder-hero-lit>",
    "css": "builder-hero-lit::part(headline){color:#f6e7d8;}"
  },
  "editor": {
    "grapesjsCss": "builder-hero-lit::part(headline){color:#f6e7d8;}"
  },
  "config": {
    "componentPath": ["heroes", "Hero"],
    "tagName": "builder-hero-lit"
  },
  "meta": {
    "createdAt": "2026-04-08T00:00:00.000Z",
    "updatedAt": "2026-04-08T00:00:00.000Z"
  }
}
```

## Field Meaning

### `schemaVersion`

Version of the artifact schema.

This makes future migrations explicit.

### `id`

Stable identifier for the saved artifact.

### `type`

High-level artifact kind.

For now, `component-instance` is enough.

Later we may introduce page, section, template, or design artifact kinds.

### `content`

Product-level content data.

This may be empty for generic components.

This field exists so host applications can attach real content state without forcing consumers to parse it back out of HTML.

### `snapshot`

This is the exact render-oriented output captured from the editor.

It contains:

- `html`
- `css`

`snapshot.html` is the serialized component markup.

`snapshot.css` is the styling required to recreate the edited result.

### `editor`

Editor-origin data that may still be useful to keep.

For now this includes:

- `grapesjsCss`

This can be the same as `snapshot.css` in early versions.

We keep it separate so the artifact can preserve editor-origin output without making every consumer depend on GrapesJS semantics.

### `config`

Typed data exporters can rely on directly.

Examples:

- `componentPath`
- `tagName`
- future component-specific options

This avoids making exporters reverse-engineer everything from raw HTML.

### `meta`

Artifact metadata such as:

- creation time
- last updated time
- future provenance fields

## Canonical Vs Derived Output

The canonical JSON artifact is the source of truth.

Everything else is derived from it.

Derived outputs are convenience formats for specific consumers.

They should be regeneratable from the artifact.

In filesystem terms:

- canonical data belongs in `archura/component-data/canonical/`
- derived outputs belong in `archura/component-data/exported/<target>/`

## Exporters

The system should support multiple exporters from the same canonical artifact.

### 1. Embed Exporter

Purpose:

- generate a custom-element wrapper that can be embedded directly

Example output:

- `my-component.js`

Usage:

```html
<my-component></my-component>
<script type="module" src="./my-component.js"></script>
```

This is useful when a deployment service or client site wants a directly embeddable component.

### 2. Deployment Exporter

Purpose:

- generate publishable HTML/CSS output

Example output:

- `component.html`
- `component.css`
- related assets

This is useful when a deployment pipeline wants static files or a publishable bundle.

### 3. NPM Exporter

Purpose:

- generate package-ready output or renderer input for app code

Example output:

- package wrapper
- renderer entry
- artifact file packaged with the component

This is useful when an application wants to install a component package and render it in code instead of embedding a standalone script tag.

### 4. CMS Renderer

Purpose:

- load the artifact directly for preview and editing flows

This is useful for draft mode, preview mode, and future editor round-tripping.

## Recommended Rules

### Rule 1

Treat the canonical JSON artifact as the only durable source of truth.

### Rule 2

Treat generated JS, HTML, CSS, and package outputs as derived artifacts.

### Rule 3

Keep `content` and `config` structured enough that host applications do not need to parse HTML to understand what was saved.

### Rule 4

Keep `snapshot.html` and `snapshot.css` available so we can reproduce the edited result faithfully.

### Rule 5

Do not make downstream consumers depend on GrapesJS project JSON if HTML/CSS snapshot output is enough.

## Why This Model

This model lets the editor act like a plugin for many kinds of software.

A host system can use the same saved artifact to:

- publish an embed
- generate a package
- store a CMS draft
- preview the edited component

Without this split, each output path tends to invent its own save format.

## Current Direction

The current export work in this repo is moving toward this model.

Today we already extract:

- serialized component HTML
- GrapesJS CSS
- generated wrapper modules for embedding

The next step is to make the canonical JSON artifact explicit and have all exports derive from it.
