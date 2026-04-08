import { LitElement, css, html } from 'lit';

/**
 * Base - Comprehensive base class for Lit components in Grapes.js
 * 
 * This class provides CSS Custom Properties for EVERY Grapes.js Style Manager sector.
 * It serves as the single source of truth for consistent styling across all components.
 * 
 * All properties are exposed as CSS variables with sensible defaults and fallbacks.
 * Components extending this class inherit all these variables automatically.
 */
export class Base extends LitElement {
  static styles = css`
    :host {
      /* ===================================================================
         ALL GRAPES.JS STYLE MANAGER SECTORS AS CSS CUSTOM PROPERTIES
         =================================================================== */

      /* 1. Positioning */
      --top: auto;
      --right: auto;
      --bottom: auto;
      --left: auto;
      --position: relative;
      --z-index: 0;

      /* 2. Display & Layout */
      --display: block;
      --overflow: visible;
      --overflow-x: visible;
      --overflow-y: visible;
      --float: none;

      /* 3. Dimensions */
      --width: 100%;
      --min-width: auto;
      --max-width: none;
      --height: auto;
      --min-height: auto;
      --max-height: none;
      --aspect-ratio: auto;

      /* 4. Margin & Padding (both individual and shorthand) */
      --margin: 0;
      --margin-top: 0;
      --margin-right: 0;
      --margin-bottom: 0;
      --margin-left: 0;
      --padding: 1.5rem;
      --padding-top: 1.5rem;
      --padding-right: 1.5rem;
      --padding-bottom: 1.5rem;
      --padding-left: 1.5rem;

      /* 5. Flexbox */
      --flex-direction: row;
      --flex-wrap: nowrap;
      --justify-content: flex-start;
      --align-items: stretch;
      --align-content: stretch;
      --align-self: auto;
      --flex-grow: 0;
      --flex-shrink: 1;
      --flex-basis: auto;
      --order: 0;
      --gap: 1rem;

      /* 6. Typography */
      --font-family: system-ui, -apple-system, sans-serif;
      --font-size: 1rem;
      --font-weight: 400;
      --line-height: 1.5;
      --letter-spacing: normal;
      --text-align: left;
      --text-transform: none;
      --text-decoration: none;

      /* 7. Colors */
      --color: #111827;
      --background-color: #ffffff;
      --border-color: #e5e7eb;
      --accent-color: #3b82f6;

      /* 8. Borders */
      --border: 1px solid #e5e7eb;
      --border-width: 1px;
      --border-style: solid;
      --border-radius: 12px;
      --border-top-left-radius: 12px;
      --border-top-right-radius: 12px;
      --border-bottom-left-radius: 12px;
      --border-bottom-right-radius: 12px;

      /* 9. Shadows & Effects */
      --box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      --text-shadow: 0 0 0 transparent;
      --opacity: 1;
      --filter: none;

      /* 10. Transitions & Transforms */
      --transition: all 0.2s ease;
      --transition-property: all;
      --transition-duration: 0.2s;
      --transition-timing-function: ease;
      --transform: none;
      --perspective: none;

      /* 11. Cursor & Interaction */
      --cursor: default;

      /* Apply all variables */
      display: var(--display);
      position: var(--position);
      top: var(--top);
      right: var(--right);
      bottom: var(--bottom);
      left: var(--left);
      width: var(--width);
      min-width: var(--min-width);
      max-width: var(--max-width);
      height: var(--height);
      min-height: var(--min-height);
      max-height: var(--max-height);
      margin: var(--margin);
      padding: var(--padding);
      border: var(--border);
      border-radius: var(--border-radius);
      background-color: var(--background-color);
      color: var(--color);
      box-shadow: var(--box-shadow);
      opacity: var(--opacity);
      cursor: var(--cursor);
      transition: var(--transition);
      transform: var(--transform);
      font-family: var(--font-family);
      font-size: var(--font-size);
      font-weight: var(--font-weight);
      line-height: var(--line-height);
      text-align: var(--text-align);
      flex-direction: var(--flex-direction);
      justify-content: var(--justify-content);
      align-items: var(--align-items);
    }
  `;

  static properties = {
    variant: { type: String }
  };

  constructor() {
    super();
    this.variant = 'default';
  }

  render() {
    return html`<slot></slot>`;
  }
}