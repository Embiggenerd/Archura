# Archura Editor — Working Reference

Start here. This is the one-page orientation for the package; the deep dives live in
[`docs/`](#docs).

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

## Docs

| Doc | What it covers |
| --- | --- |
| [EDITOR_API_SPEC.md](docs/EDITOR_API_SPEC.md) | The editor's public API surface. |
| [EDITOR_EMBEDDING_MODEL.md](docs/EDITOR_EMBEDDING_MODEL.md) | How hosts embed the editor and wire the controller. |
| [EDITOR_PARITY.md](docs/EDITOR_PARITY.md) | Road to a Webflow-level editor. |
| [ARTICLES_APP.md](docs/ARTICLES_APP.md) | First collection-backed app: Markdown-canonical knowledge/articles, math + wikilink graph, AEO. |
| [GAPS_AND_SOLUTIONS.md](docs/GAPS_AND_SOLUTIONS.md) | Current gaps and the plan to close them. Source of truth for state. |
| [STRIPE_COMPONENT.md](docs/STRIPE_COMPONENT.md) | Embedded Stripe component — gaps and how to close them. |
| [FUNNEL.md](docs/FUNNEL.md) | Deploy funnel: anonymous → confirmed → published → paid. |
| [DASHBOARD.md](docs/DASHBOARD.md) | Tenant dashboard (later sprint). |
| [AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md) | Identity & auth for the B2B2C multi-tenant model. |
| [CORE_SERVER.md](docs/CORE_SERVER.md) | The Go core server — design & build reference. |
| [FINTECH_ARCHITECTURE.md](docs/FINTECH_ARCHITECTURE.md) | Trust boundaries and the edge/core split. |

For current status and what's next, see [GAPS_AND_SOLUTIONS.md](docs/GAPS_AND_SOLUTIONS.md)
and [EDITOR_PARITY.md](docs/EDITOR_PARITY.md) — not this file.
