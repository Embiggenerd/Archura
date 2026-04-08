import { css, html } from 'lit';
import { Base } from '../base/Base.js';

/**
 * Card Component
 * 
 * grapesTagName: my-card
 * 
 * Public Styling API (CSS Custom Properties):
 * --card-bg, --card-padding, --card-radius, --card-shadow, --card-border, etc.
 */
export class Card extends Base {
  static grapesTagName = 'my-card';

  static styles = [
    Base.styles || '',
    css`
      :host {
        --card-bg: #ffffff;
        --card-padding: 2rem;
        --card-radius: 16px;
        --card-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
        --card-border: 1px solid #e5e7eb;
      }

      .card {
        background: var(--card-bg);
        padding: var(--card-padding);
        border-radius: var(--card-radius);
        box-shadow: var(--card-shadow);
        border: var(--card-border);
      }
    `
  ];

  static properties = {
    title: { type: String },
    content: { type: String }
  };

  constructor() {
    super();
    this.title = 'Card Title';
    this.content = 'This is a clean card component built on the Base class.';
  }

  render() {
    return html`
      <div class="card">
        <h3>${this.title}</h3>
        <p>${this.content}</p>
        <slot></slot>
      </div>
    `;
  }
}

customElements.define(Card.grapesTagName, Card);
