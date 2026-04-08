# Grapes.js + Lit Web Components Architecture Summary

This document summarizes a detailed conversation with Grok about building a visual page builder using **Grapes.js** with **Lit Web Components** that are registered as custom component types.

## Core Decision

**Persist using Grapes.js’s native Project Data JSON** as the single source of truth.

- Use `StorageManager` + `editor.getProjectData()` / `editor.store()` / `editor.loadProjectData()`
- This captures component hierarchy, traits/props, per-component styles, global CSS, pages, symbols, etc.
- Cleanest, most robust, and least custom-code-heavy approach.

**Why this wins:**
- Complete & lossless
- Battle-tested (localStorage or remote backend)
- Reusable components via snapshots
- Native undo/redo, autosave, versioning
- Lit + Shadow DOM friendly when implemented correctly

## How Styles Reach the Shadow DOM

Grapes.js only edits the **host element**. Lit components consume styles via:

### Priority Order for CSS Bridges

1. **CSS Custom Properties (CSS Variables)** — Highest priority (recommended)
2. **CSS Shadow Parts (`::part`)** — Second priority
3. **AdoptedStyleSheets** — Lowest priority (escape hatch only)

CSS vars automatically pierce Shadow DOM and are applied as inline styles on the host by Grapes.js.

## Component Design Guidelines

Treat every component as a **"Grapes-native primitive"**:

- Small, self-contained atoms/molecules
- Expose every style surface via CSS custom properties (first) then `::part`
- Use composition via `<slot>` (avoid deep nesting inside one component)
- Pre-wire all styles the designer might want to change
- No free-form classes, no reliance on global CSS, no external complex animations

### 1. Base Class (for scaling)

```typescript
// src/base/grapes-lit-base.ts
import { LitElement, css } from 'lit';
import { property } from 'lit/decorators.js';

export abstract class BaseGrapesLitElement extends LitElement {
  static baseStyles = css`
    :host {
      --component-bg: #ffffff;
      --component-padding: 1rem;
      --component-radius: 8px;
      --component-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
      --component-text: #111827;
      display: block;
      background: var(--component-bg);
      padding: var(--component-padding);
      border-radius: var(--component-radius);
      box-shadow: var(--component-shadow);
      color: var(--component-text);
      width: 100%;
      box-sizing: border-box;
    }
  `;

  @property({ type: String }) variant = 'default';

  static registerGrapes(editor: any, tagName: string, options: any = {}) {
    const domc = editor.DomComponents;
    domc.addType(tagName, {
      isComponent: (el: Element) => el.tagName === tagName.toUpperCase(),
      model: {
        defaults: {
          tagName,
          stylable: true,
          traits: options.traits || [],
          ...options.modelDefaults,
        },
      },
      view: {},
    });
  }
}
```

### 2. Typical Lit Component Example (`MyLitCard`)

```typescript
import { html } from 'lit';
import { property } from 'lit/decorators.js';
import { BaseGrapesLitElement } from '../base/grapes-lit-base.js';

export class MyLitCard extends BaseGrapesLitElement {
  static styles = [
    BaseGrapesLitElement.baseStyles,
    css`
      :host {
        --card-bg: #ffffff;
        --card-padding: 1.5rem;
        --card-radius: 12px;
        --card-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
        --card-text: #111827;
        --card-title-size: 1.25rem;
      }

      ::part(title) {
        font-size: var(--card-title-size);
        font-weight: 600;
      }
    `,
  ];

  @property({ type: String }) title = 'Card Title';
  @property({ type: String }) body = 'Card content';

  render() {
    return html`
      <h3 part="title">${this.title}</h3>
      <p part="body">${this.body}</p>
      <slot></slot>
    `;
  }
}

customElements.define('my-lit-card', MyLitCard);
```

### 3. Full Demo Component (covers all CSS fields)

The conversation included a comprehensive `MyGrapesFullDemo` component that declares **every** property from your provided CSS fields list as a CSS custom property.

```typescript
import { LitElement, html, css } from 'lit';
import { property } from 'lit/decorators.js';

export class MyGrapesFullDemo extends LitElement {
  static styles = css`
    :host {
      /* All Grapes.js fields as CSS vars */
      --text-shadow-h: 0; --top: auto; --right: auto; --bottom: auto; --left: auto;
      --margin-top: 0; --margin-right: 0; --margin-bottom: 0; --margin-left: 0;
      --padding-top: 1.5rem; --padding-right: 1.5rem; --padding-bottom: 1.5rem; --padding-left: 1.5rem;
      --width: 100%; --min-width: auto; --max-width: none;
      --height: auto; --min-height: auto; --max-height: none;
      --font-size: 1rem; --letter-spacing: normal; --line-height: 1.5;
      --border-radius-c: 12px; --border-width: 2px;
      --box-shadow-h: 0; --box-shadow-v: 10px; --box-shadow-blur: 15px; --box-shadow-spread: -3px;
      --transition-duration: 0.3s; --opacity: 1; --display: block;
      --color: #111827; --background-color: #ffffff; --border-color: #e5e7eb;
      /* ... (many more vars for flex, shadows, background, transform, etc.) */

      display: var(--display);
      background: var(--background-color);
      color: var(--color);
      padding: var(--padding);
      border-radius: var(--border-radius-c);
      box-shadow: var(--box-shadow);
      transition: var(--transition);
      /* ... all other properties mapped similarly */
    }

    ::part(title) { font-size: var(--font-size); }
    ::part(body) { line-height: var(--line-height); }
  `;

  @property({ type: String }) title = 'Full Grapes.js Demo';
  @property({ type: String }) body = 'Every Style Manager control works here.';

  render() {
    return html`
      <h2 part="title">${this.title}</h2>
      <div part="body">${this.body}</div>
      <slot></slot>
      <button part="button">Click me</button>
    `;
  }
}

customElements.define('my-grapes-full-demo', MyGrapesFullDemo);
```

This is the ideal component for testing the complete Style Manager coverage. A similar file already exists in the v2 example.

## Initial Plugin Example (from conversation)

```js
const litWcPlugin = (editor) => {
  const domc = editor.DomComponents;

  domc.addType('my-lit-hero', {
    isComponent: (el) => el.tagName === 'MY-LIT-HERO',

    model: {
      defaults: {
        tagName: 'my-lit-hero',
        traits: [
          { type: 'text', name: 'title', label: 'Title' },
          { type: 'text', name: 'subtitle', label: 'Subtitle' },
        ],
        style: {},
        styles: [
          ':host { display: block; }',
        ],
      },
    },

    view: {
      onRender() {},
      updateStyle() {
        const el = this.el;
        const litInstance = el;
        if (litInstance && litInstance.updateStyles) {
          litInstance.updateStyles(this.model.getStyle());
        }
      },
    },
  });

  editor.Blocks.add('lit-hero-block', {
    label: 'Lit Hero',
    content: { type: 'my-lit-hero' },
    category: 'Lit Components',
  });
};
```

**Usage:**
```js
const editor = grapesjs.init({
  container: '#gjs',
  plugins: [litWcPlugin],
  // ... storageManager, etc.
});
```

Add as a Block for drag-and-drop.

## Project JSON Structure (What Gets Persisted)

```json
{
  "components": [
    {
      "type": "my-lit-card",
      "tagName": "my-lit-card",
      "style": {
        "--card-bg": "#ffffff",
        "--card-padding": "1.5rem",
        "background-color": "#ffffff"
      },
      "attributes": { "title": "Edited Title" }
    }
  ],
  "css": "my-lit-card { --card-bg: #ffffff; }",
  "pages": [],
  "symbols": []
}
```

This full JSON is what `editor.store()` saves and `editor.loadProjectData()` restores.

## StorageManager Configuration

```js
storageManager: {
  type: 'remote', // or 'local'
  autosave: true,
  autoload: true,
  options: {
    remote: {
      urlStore: '/api/save-project',
      urlLoad: '/api/load-project',
    }
  }
}
```

Backend simply stores the full JSON blob (PostgreSQL JSONB, Firebase, etc.).

## Testing Compliance

The conversation provided detailed testing strategies:

### 1. Lit Unit Test Example
```typescript
it('consumes CSS custom properties from host', async () => {
  const el = await fixture(html`
    <my-lit-card style="--card-bg: rgb(255, 0, 0); --card-padding: 3rem;"></my-lit-card>
  `);

  const hostStyle = getComputedStyle(el);
  expect(hostStyle.backgroundColor).to.equal('rgb(255, 0, 0)');
  // Check inside Shadow DOM via shadowRoot
});
```

### 2. Grapes.js Integration Test (Playwright example)
```typescript
test('Grapes.js + Lit card applies host styles', async ({ page }) => {
  // Register plugin, drag component, apply style via model, assert computed styles
  await page.evaluate(() => {
    const cmp = window.editor.getSelected();
    cmp.setStyle({ '--card-bg': 'rgb(0, 128, 0)' });
  });
});
```

### Style Syncing in Custom View (Important)

```js
view: {
  initialize() {
    this.listenTo(this.model, 'change:style', this.applyToShadow);
  },
  applyToShadow() {
    const host = this.el;
    if (host.shadowRoot) {
      Object.entries(this.model.getStyle()).forEach(([k, v]) => {
        if (k.startsWith('--')) {
          host.style.setProperty(k, v);
        }
      });
    }
  },
  events: { 'component:styleUpdate': 'syncStylesToLit' },
  syncStylesToLit() {
    // Grapes.js already applies inline styles to host — Lit sees CSS vars automatically
  }
}
```

### 3. Persistence Round-trip
- Call `editor.getProjectData()` → save JSON
- Call `editor.loadProjectData(savedJson)` → verify styles are restored on host and visible in Shadow DOM

**Compliance Checklist:**
- All desired Style Manager sectors have corresponding `--var` or `::part`
- `stylable: true` is set
- Component works in composition via `<slot>`
- Persistence round-trip passes
- No console errors during style updates

## Coverage Estimate

With composition-only, pre-wired styles, and the CSS-vars + `::part` approach:
- **95–100%** of the Grapes.js Style Manager universe is captured
- Editing experience feels **very native** (9.5–10/10)

## Key Files & Next Steps

- `grapesjs-lit-architecture.md` (this file)
- Lit components following the `BaseGrapesLitElement` + CSS-vars pattern
- Grapes.js plugin with `addType` registrations
- StorageManager implementation + backend endpoint

**References from conversation:**
- Full demo component covering all CSS fields
- Base class + mixin pattern for scaling to many components
- Detailed testing examples
- Shadow DOM style bridging explanations
- Style syncing patterns (`change:style`, `component:styleUpdate`)
- Project JSON persistence structure

---

**Created from the Grok.com conversation pasted on 2026-04-06.**

This document now contains the major code snippets and architectural decisions from the full conversation. It serves as the canonical reference for the `example-app-v3` implementation.

**Next steps suggestion:** Create individual component files based on the `BaseGrapesLitElement` pattern and wire up the plugin + StorageManager in the v3 example app.

