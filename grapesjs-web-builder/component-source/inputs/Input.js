import { css, html } from 'lit';
import { Base } from '../base/Base.js';

/**
 * Input Component
 * 
 * grapesTagName: my-input
 * 
 * Public Styling API (CSS Custom Properties):
 * --input-bg, --input-border, --input-focus-border, --input-padding, etc.
 */
export class Input extends Base {
  static grapesTagName = 'my-input';

  static styles = [
    Base.styles || '',
    css`
      :host {
        --input-bg: white;
        --input-border: 2px solid #d1d5db;
        --input-focus-border: 2px solid #3b82f6;
        --input-padding: 0.75rem 1rem;
        --input-radius: 8px;
      }

      input {
        background: var(--input-bg);
        border: var(--input-border);
        padding: var(--input-padding);
        border-radius: var(--input-radius);
        width: 100%;
        font-size: 1rem;
        transition: border 0.2s ease;
      }

      input:focus {
        outline: none;
        border: var(--input-focus-border);
      }
    `
  ];

  static properties = {
    placeholder: { type: String },
    value: { type: String }
  };

  constructor() {
    super();
    this.placeholder = 'Type something...';
    this.value = '';
  }

  render() {
    return html`
      <input 
        type="text" 
        placeholder=${this.placeholder}
        .value=${this.value}
        @input=${(e) => this.value = e.target.value}>
    `;
  }
}

customElements.define(Input.grapesTagName, Input);
