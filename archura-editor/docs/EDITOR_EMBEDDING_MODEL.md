# Editor Embedding Model

This document defines how `archura-editor` should be built and consumed.

The editor should be built from:

- an `ArchuraEditorController`
- Lit-based editor primitives
- a full `<archura-editor>` element composed from those primitives

## Public Surfaces

### 1. Full Editor Element

The easiest integration surface is:

```html
<archura-editor></archura-editor>
```

This should render the default assembled editor experience.

It should:

- render the default editor UI
- use `ArchuraEditorController` internally
- accept configuration through properties or attributes
- surface save and lifecycle behavior for the host

### 2. Lower-Level Lit Elements

The editor should also expose lower-level Lit-based elements so host applications can compose their own layout.

Example:

```html
<archura-editor-shell>
  <archura-toolbar></archura-toolbar>
  <archura-canvas></archura-canvas>
  <archura-styling-panel></archura-styling-panel>
</archura-editor-shell>
```

Candidate elements:

- `<archura-editor-shell>`
- `<archura-toolbar>`
- `<archura-canvas>`
- `<archura-styling-panel>`
- `<archura-inspector>`

These elements should all bind to the same controller instance.

### 3. Controller Foundation

The controller is the engine underneath the Lit UI.

Example:

```ts
const editor = new ArchuraEditorController({
  componentPath: ['cards', 'Card']
});

await editor.init();
editor.render(container);
```

The controller should own:

- state
- lifecycle
- save logic
- canonical artifact creation
- coordination between editor surfaces

The controller plus Lit should be sufficient to build the whole editor.

## Save Contract

Archura should emit canonical artifacts.

Archura should not require ownership of:

- filesystem writes
- deployment
- adapter execution

The host application decides what to do with canonical artifacts after save.

## Responsibility Split

Archura should provide:

- `ArchuraEditorController`
- Lit-based editor elements
- canonical artifact generation

The host application should decide:

- where artifacts are stored
- whether artifacts are persisted locally, remotely, or in memory
- whether component-data adapters are run
- how the surrounding product UI is organized

## Core Architecture

The preferred architecture is:

1. `ArchuraEditorController`
2. Lit-based editor primitives
3. `<archura-editor>` as the default composition

This means:

- the controller is the engine
- Lit is the UI layer
- the full editor is a default composition, not a separate implementation

This keeps the system small and prevents duplicate editor behavior.

## Example Integration Shapes

### Full Editor

```html
<archura-editor component-path="cards/Card"></archura-editor>
```

### Composed Editor

```html
<archura-editor-shell>
  <archura-toolbar></archura-toolbar>
  <archura-canvas></archura-canvas>
  <archura-styling-panel></archura-styling-panel>
</archura-editor-shell>
```

### Controller-Driven Composition

```ts
const editor = new ArchuraEditorController({
  componentPath: ['cards', 'Card']
});

await editor.init();
editor.render(document.getElementById('editor-root'));
```

## Why This Model

This model gives Archura:

- an easy default integration path
- a composable lower-level path
- a small, coherent implementation model

It also keeps the save boundary clean:

- editor runtime creates canonical artifacts
- host software decides what to do next

## Recommended Next Step

The next step after this document is to define:

1. the exact controller API
2. the shared config shape
3. the Lit primitive list and responsibilities
4. the default composition used by `<archura-editor>`
