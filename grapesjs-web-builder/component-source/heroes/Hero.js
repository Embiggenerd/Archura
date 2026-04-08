import { css, html } from 'lit';
import { Base } from '../base/Base.js';

/**
 * Hero Component
 * 
 * grapesTagName: my-hero
 * 
 * Public Styling API (CSS Custom Properties):
 * --hero-bg, --hero-text, --hero-overlay, --hero-height, etc.
 */
export class Hero extends Base {
  static grapesTagName = 'my-hero';

  static styles = [
    Base.styles || '',
    css`
      :host {
        --hero-bg: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        --hero-text: white;
        --hero-height: 400px;
        --hero-overlay: rgba(0, 0, 0, 0.3);
      }

      .hero {
        height: var(--hero-height);
        background: var(--hero-bg);
        color: var(--hero-text);
        display: flex;
        align-items: center;
        justify-content: center;
        text-align: center;
        position: relative;
      }

      .hero::before {
        content: '';
        position: absolute;
        inset: 0;
        background: var(--hero-overlay);
      }

      .content {
        position: relative;
        z-index: 1;
      }
    `
  ];

  static properties = {
    headline: { type: String },
    subheadline: { type: String }
  };

  constructor() {
    super();
    this.headline = 'Welcome to the Future';
    this.subheadline = 'Built with Lit and Grapes.js';
  }

  render() {
    return html`
      <div class="hero">
        <div class="content">
          <h1>${this.headline}</h1>
          <p>${this.subheadline}</p>
          <slot></slot>
        </div>
      </div>
    `;
  }
}

customElements.define(Hero.grapesTagName, Hero);
