import { css, html } from 'lit';
import { Base } from '../base/Base.js';

export class Image extends Base {
  static grapesTagName = 'archura-image';

  static styles = [
    Base.styles,
    css`
      :host {
        --padding: 0;
        --border: none;
        --background-color: transparent;
        --box-shadow: none;
      }

      img {
        display: block;
        width: 100%;
        height: var(--image-height, auto);
        object-fit: var(--object-fit, cover);
        border-radius: var(--border-radius, 12px);
      }

      .placeholder {
        display: grid;
        place-items: center;
        min-height: 120px;
        border: 1px dashed #d1d5db;
        border-radius: var(--border-radius, 12px);
        color: #9ca3af;
        font-size: 0.9rem;
      }
    `,
  ];

  static properties = {
    src: { type: String, asset: true },
    alt: { type: String },
    animation: { type: String, options: ['none', 'fade-up'] },
  };

  static styleParts = {
    host: ['spacing', 'dimension', 'decorations', 'hover'],
  };

  static resize = { width: true, min: 120 };

  constructor() {
    super();
    this.src = '';
    this.alt = '';
    this.animation = 'none';
  }

  render() {
    return this.src
      ? html`<img src=${this.src} alt=${this.alt} />`
      : html`<div class="placeholder">Choose an image</div>`;
  }
}

if (!customElements.get(Image.grapesTagName)) {
  customElements.define(Image.grapesTagName, Image);
}
