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
  };

  constructor() {
    super();
    this.heading = 'Hero Heading';
    this.subheading = 'A short line that supports the heading.';
  }

  render() {
    return html`
      <div class="hero">
        <h1 part="heading">${this.heading}</h1>
        <p part="subheading">${this.subheading}</p>
      </div>
    `;
  }
}

customElements.define(Hero.grapesTagName, Hero);
