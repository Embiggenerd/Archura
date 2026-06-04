import { LitElement, html, css } from 'lit';
import { property } from 'lit/decorators.js';

/**
 * my-grapes-full-demo
 * A single, self-contained Lit Web Component that exposes **every** CSS field
 * Grapes.js can edit (from the exact list you provided) via CSS Custom Properties.
 *
 * This is the "ultimate demo component" for your system. Drop it into Grapes.js
 * and the Style Manager will control everything — no missing properties, no deep nesting,
 * full compliance with our CSS-vars-first + ::part strategy.
 */
export class MyGrapesFullDemo extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'open' as const };

  /** Inline styles applied by GrapesJS (host); merged with static :host var bridge */
  editorStyles: Record<string, string> = {};

  updateStyles(styles: Record<string, string> = {}) {
    this.editorStyles = { ...styles };
    for (const [property, value] of Object.entries(this.editorStyles)) {
      if (value == null || value === '') {
        this.style.removeProperty(property);
      } else {
        this.style.setProperty(property, String(value));
      }
    }
    this.requestUpdate();
  }

  applyEditorAttributes(attributes: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(attributes)) {
      if (name.startsWith('data-gjs-') || name === 'id' || name === 'draggable') continue;
      if (value == null) continue;
      this.setAttribute(name, String(value));
    }
  }

  // ── ALL Grapes.js fields as CSS Custom Properties (highest-priority bridge) ──
  static styles = css`
    :host {
      /* === Every property from your list === */
      --text-shadow-h: 0;
      --top: auto;
      --right: auto;
      --bottom: auto;
      --left: auto;
      --margin-top: 0;
      --margin-right: 0;
      --margin-bottom: 0;
      --margin-left: 0;
      --padding-top: 1.5rem;
      --padding-right: 1.5rem;
      --padding-bottom: 1.5rem;
      --padding-left: 1.5rem;
      --width: 100%;
      --min-width: auto;
      --max-width: none;
      --height: auto;
      --min-height: auto;
      --max-height: none;
      --flex-basis: auto;
      --font-size: 1rem;
      --letter-spacing: normal;
      --line-height: 1.5;
      --text-shadow-v: 0;
      --text-shadow-blur: 0;
      --border-radius-c: 12px;
      --border-top-left-radius: 12px;
      --border-top-right-radius: 12px;
      --border-bottom-left-radius: 12px;
      --border-bottom-right-radius: 12px;
      --border-width: 2px;
      --box-shadow-h: 0;
      --box-shadow-v: 10px;
      --box-shadow-blur: 15px;
      --box-shadow-spread: -3px;
      --transition-duration: 0.3s;
      --perspective: none;
      --order: 0;
      --flex-grow: 0;
      --flex-shrink: 1;
      --float: none;
      --position: relative;
      --text-align: left;
      --color: #111827;
      --text-shadow-color: rgba(0,0,0,0.2);
      --border-color: #e5e7eb;
      --box-shadow-color: rgba(0,0,0,0.1);
      --background-color: #ffffff;
      --background-image: none;
      --opacity: 1;
      --display: block;
      --flex-direction: column;
      --flex-wrap: nowrap;
      --justify-content: flex-start;
      --align-items: stretch;
      --align-content: stretch;
      --align-self: auto;
      --font-family: system-ui, -apple-system, sans-serif;
      --font-weight: 400;
      --border-style: solid;
      --box-shadow-type: outset;
      --background-repeat: no-repeat;
      --background-position: center center;
      --background-attachment: scroll;
      --background-size: cover;
      --transition-property: all;
      --transition-timing-function: ease;
      --cursor: default;
      --overflow: visible;
      --overflow-x: visible;
      --overflow-y: visible;
      --margin: 0;
      --padding: 1.5rem;
      --border: 2px solid #e5e7eb;
      --border-radius: 12px;
      --transition: all 0.3s ease;
      --box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      --text-shadow: 0 0 0 transparent;
      --background: #ffffff;
      --transform: none;

      /* Apply them to the host */
      display: var(--display);
      position: var(--position);
      float: var(--float);
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
      margin-top: var(--margin-top);
      margin-right: var(--margin-right);
      margin-bottom: var(--margin-bottom);
      margin-left: var(--margin-left);
      padding: var(--padding);
      padding-top: var(--padding-top);
      padding-right: var(--padding-right);
      padding-bottom: var(--padding-bottom);
      padding-left: var(--padding-left);
      border: var(--border);
      border-width: var(--border-width);
      border-style: var(--border-style);
      border-color: var(--border-color);
      border-radius: var(--border-radius);
      border-top-left-radius: var(--border-top-left-radius);
      border-top-right-radius: var(--border-top-right-radius);
      border-bottom-left-radius: var(--border-bottom-left-radius);
      border-bottom-right-radius: var(--border-bottom-right-radius);
      background: var(--background);
      background-color: var(--background-color);
      background-image: var(--background-image);
      background-repeat: var(--background-repeat);
      background-position: var(--background-position);
      background-attachment: var(--background-attachment);
      background-size: var(--background-size);
      box-shadow: var(--box-shadow);
      color: var(--color);
      font-family: var(--font-family);
      font-size: var(--font-size);
      font-weight: var(--font-weight);
      line-height: var(--line-height);
      letter-spacing: var(--letter-spacing);
      text-align: var(--text-align);
      text-shadow: var(--text-shadow-h) var(--text-shadow-v) var(--text-shadow-blur) var(--text-shadow-color);
      opacity: var(--opacity);
      cursor: var(--cursor);
      overflow: var(--overflow);
      overflow-x: var(--overflow-x);
      overflow-y: var(--overflow-y);
      transition: var(--transition);
      transition-property: var(--transition-property);
      transition-duration: var(--transition-duration);
      transition-timing-function: var(--transition-timing-function);
      transform: var(--transform);
      perspective: var(--perspective);
      order: var(--order);
      flex-basis: var(--flex-basis);
      flex-grow: var(--flex-grow);
      flex-shrink: var(--flex-shrink);
      flex-direction: var(--flex-direction);
      flex-wrap: var(--flex-wrap);
      justify-content: var(--justify-content);
      align-items: var(--align-items);
      align-content: var(--align-content);
      align-self: var(--align-self);
    }

    /* Internal parts so typography, flex children, etc. are also visible */
    ::part(title) {
      font-size: var(--font-size);
      font-weight: var(--font-weight);
      color: var(--color);
      text-shadow: var(--text-shadow);
    }

    ::part(body) {
      font-size: calc(var(--font-size) * 0.95);
      line-height: var(--line-height);
    }

    ::part(button) {
      background-color: var(--background-color);
      color: var(--color);
      border: var(--border);
      border-radius: var(--border-radius);
      padding: 0.75rem 1.5rem;
      transition: var(--transition);
      cursor: var(--cursor);
    }

    .flex-demo {
      display: flex;
      flex-direction: var(--flex-direction);
      flex-wrap: var(--flex-wrap);
      justify-content: var(--justify-content);
      align-items: var(--align-items);
      gap: 1rem;
    }
  `;

  @property({ type: String, reflect: true }) title = 'Full Grapes.js Demo';
  @property({ type: String, reflect: true }) body = 'Every Style Manager control works here.';

  render() {
    return html`
      <h2 part="title">${this.title}</h2>
      <div part="body">${this.body}</div>

      <!-- Demo flex container to show flex properties -->
      <div class="flex-demo">
        <div style="background:#f3e8ff; padding:1rem; border-radius:8px;">Flex child 1</div>
        <div style="background:#dbeafe; padding:1rem; border-radius:8px;">Flex child 2</div>
        <div style="background:#ecfdf5; padding:1rem; border-radius:8px;">Flex child 3</div>
      </div>

      <!-- Composition slot (other Lit components can be dropped here) -->
      <slot></slot>

      <!-- Button to test button-specific styles -->
      <button part="button" @click=${() => console.log('Clicked!')}>
        Click me
      </button>
    `;
  }
}

customElements.define('my-grapes-full-demo', MyGrapesFullDemo);