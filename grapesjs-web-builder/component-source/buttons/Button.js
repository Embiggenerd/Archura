import { css, html } from 'lit';
import { Base } from '../base/Base.js';

/**
 * Button Component
 * 
 * grapesTagName: my-button
 * 
 * Public Styling API (CSS Custom Properties):
 * --button-bg, --button-color, --button-padding, --button-radius, 
 * --button-border, --button-shadow, --button-hover-bg, etc.
 */
export class Button extends Base {
  static grapesTagName = 'my-button';

  static styles = [
    Base.styles || '',
    css`
      :host {
        --button-bg: #3b82f6;
        --button-color: white;
        --button-padding: 0.75rem 1.5rem;
        --button-radius: 9999px;
        --button-border: none;
        --button-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
        --button-hover-bg: #2563eb;
      }

      button {
        background: var(--button-bg);
        color: var(--button-color);
        padding: var(--button-padding);
        border-radius: var(--button-radius);
        border: var(--button-border);
        box-shadow: var(--button-shadow);
        cursor: pointer;
        font-weight: 600;
        transition: all 0.2s ease;
      }

      button:hover {
        background: var(--button-hover-bg);
        transform: translateY(-1px);
      }
    `
  ];

  static properties = {
    label: { type: String }
  };

  constructor() {
    super();
    this.label = 'Click me';
  }

  render() {
    return html`
      <button>${this.label}</button>
    `;
  }
}

customElements.define(Button.grapesTagName, Button);
