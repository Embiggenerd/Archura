import { css, html } from 'lit';
import { Base } from '../base/Base.js';

export class Hero extends Base {
  static grapesTagName = 'archura-hero';

  static styles = [
    Base.styles,
    css`
      :host {
        --hero-align: center;
        --padding: 4rem 2rem;
      }

      .hero {
        text-align: var(--hero-align);
      }

      .logo {
        display: inline-block;
        height: var(--logo-height, 48px);
        width: auto;
        object-fit: contain;
        margin-bottom: 12px;
      }

      h1 {
        margin: 0 0 0.5rem;
        font-size: 2.25rem;
      }

      p {
        margin: 0;
        font-size: 1.15rem;
        opacity: 0.8;
      }
    `,
  ];

  static properties = {
    heading: { type: String },
    subheading: { type: String },
    logoSrc: { type: String, asset: true },
    animation: { type: String, options: ['none', 'fade-up'] },
  };

  static styleParts = {
    heading: ['typography'],
    subheading: ['typography'],
  };

  constructor() {
    super();
    this.heading = 'Hero Heading';
    this.subheading = 'A short line that supports the heading.';
    this.logoSrc = '';
    this.animation = 'none';
  }

  render() {
    return html`
      <div class="hero">
        ${this.logoSrc ? html`<img class="logo" src=${this.logoSrc} alt="" />` : ''}
        <h1 part="heading" data-edit="heading">${this.heading}</h1>
        <p part="subheading" data-edit="subheading">${this.subheading}</p>
      </div>
    `;
  }
}

if (!customElements.get(Hero.grapesTagName)) {
  customElements.define(Hero.grapesTagName, Hero);
}
