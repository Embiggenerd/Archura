import { css, html } from 'lit';
import { Base } from '../base/Base.js';

/**
 * Badge Component
 * 
 * grapesTagName: my-badge
 * 
 * Public Styling API (CSS Custom Properties):
 * --badge-bg, --badge-color, --badge-padding, --badge-radius, etc.
 */
export class Badge extends Base {
  static grapesTagName = 'my-badge';

  static styles = [
    Base.styles || '',
    css`
      :host {
        --badge-bg: #3b82f6;
        --badge-color: white;
        --badge-padding: 0.25rem 0.75rem;
        --badge-radius: 9999px;
        --badge-size: 0.875rem;
      }

      .badge {
        display: inline-block;
        background: var(--badge-bg);
        color: var(--badge-color);
        padding: var(--badge-padding);
        border-radius: var(--badge-radius);
        font-size: var(--badge-size);
        font-weight: 600;
        line-height: 1;
      }
    `
  ];

  static properties = {
    text: { type: String }
  };

  constructor() {
    super();
    this.text = 'New';
  }

  render() {
    return html`
      <span class="badge">${this.text}</span>
    `;
  }
}

customElements.define(Badge.grapesTagName, Badge);
