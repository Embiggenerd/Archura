# Archura V2 — Working Reference

## Goal

A composable, embeddable, no-code WYSIWYG editor shipped as a web component package.
Embedding sites drop in the primitives, wire them to a controller, and own their own layout.
End users drag, drop, and click to build pages and components. No code changes required.

## What this package provides

- `ArchuraEditorController` — the engine. Owns state, save, load, artifact creation.
- `<archura-canvas>` — the editable surface, powered by GrapesJS.
- `<archura-styling-panel>` — traits and style controls, sourced from GrapesJS.
- `<archura-toolbar>` — save and editor actions.
- `<archura-editor-shell>` — the default layout composition of the above.
- `<archura-editor>` — zero-config drop-in that wraps everything.
- A component library (Hero, Card, Button, etc.) registered into GrapesJS.

## What this package does NOT own

- Where artifacts are stored.
- How artifacts are deployed.
- The surrounding product UI layout.

The host application decides all of that.

## Architecture rules

- All primitives bind to the same `ArchuraEditorController` instance.
- The controller is the only shared state. Primitives do not talk to each other directly.
- GrapesJS lives inside the controller. Primitives ask the controller for what they need.
- The canonical artifact (`CanonicalComponentData`) is the only save format.
- Adding a new primitive means wiring it to the controller, not to other primitives.

## Current state of v2

The controller, elements, canonical artifact type, and layout shell are implemented.

The critical gap: GrapesJS has not been wired in yet.

- `ArchuraCanvas` currently writes static HTML/CSS into an iframe. It needs to host a real GrapesJS canvas.
- `ArchuraStylingPanel` currently shows raw textareas. It needs to show GrapesJS traits and style manager.
- The Lit component library from v1 has not been registered into the v2 GrapesJS instance.

## V1 is reference only

`archura/` contains working GrapesJS + Lit integration code. Use it to understand:

- How GrapesJS is initialized: `archura/editor/src/lib/editor/`
- How Lit components are registered as GrapesJS types: `archura/component-source/`
- How artifacts are extracted: `archura/editor/src/lib/artifacts/`

Do not modify v1. Do not import from it into v2.

## Next steps in order

1. Add GrapesJS to v2 dependencies.
2. Initialize GrapesJS inside `ArchuraEditorController.init()`.
3. Wire `ArchuraCanvas` to the GrapesJS canvas element.
4. Wire `ArchuraStylingPanel` to GrapesJS Style Manager and Traits.
5. Wire `controller.save()` to extract canonical artifact from GrapesJS state.
6. Register the component library into the GrapesJS instance.
7. Expose a blocks panel so components can be dragged onto the canvas.
