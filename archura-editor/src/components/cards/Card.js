import { css, html } from 'lit';
import { Base } from '../base/Base.js';

export class Card extends Base {
  static grapesTagName = 'archura-card';

  // The host paints background/padding/border via the Base contract;
  // internals must never shadow contract props with their own paint.
  static styles = [
    Base.styles,
    css`
      h3 {
        margin: 0 0 8px;
        font-size: 1.25rem;
      }

      p {
        margin: 0;
      }
    `,
  ];

  static properties = {
    title: { type: String },
    content: { type: String },
    animation: { type: String, options: ['none', 'fade-up'] },
  };

  static styleParts = {
    title: ['typography'],
    content: ['typography'],
  };

  // min/max apply to both axes in GrapesJS, so keep the floor low enough
  // for card heights
  static resize = { width: true, height: true, min: 60, max: 1400 };

  constructor() {
    super();
    this.title = 'Card Title';
    this.content = 'This is a card component.';
    this.animation = 'none';
  }

  render() {
    return html`
      <h3 part="title" data-edit="title">${this.title}</h3>
      <p part="content" data-edit="content">${this.content}</p>
      <slot></slot>
    `;
  }
}

if (!customElements.get(Card.grapesTagName)) {
  customElements.define(Card.grapesTagName, Card);
}
