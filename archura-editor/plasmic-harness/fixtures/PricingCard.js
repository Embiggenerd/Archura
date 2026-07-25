// Hand-written stand-in for Plasmic-to-Archura compiler output (Step 0).
// Mirrors exactly what the exporter will emit for a reusable component:
// Base subclass, all-lowercase props, host var() rewrite for contract
// properties, plain trusted CSS on named parts, 991/767 media queries.
import { css, html } from 'lit';
import { Base } from '../../src/components/base/Base.js';

export class FixturePricingCard extends Base {
  static grapesTagName = 'archura-fixture-pricingcard-k3x9q2';

  static properties = {
    name: { type: String },
    price: { type: String },
    featured: { type: Boolean, reflect: true },
  };

  static styleParts = {
    title: ['typography'],
    price: ['typography'],
  };

  static styles = [
    Base.styles,
    css`
      /* Host: contract properties keep the Archura custom-property control
         with the Plasmic value as fallback; gap is outside the contract and
         stays trusted static CSS. */
      :host {
        display: var(--display, flex);
        flex-direction: var(--flex-direction, column);
        padding: var(--padding, 24px);
        border: var(--border, 1px solid #cbd5e1);
        background-color: var(--background-color, #f8fafc);
        gap: 8px;
      }

      /* Named parts: plain declarations. The editor overrides them from the
         outer tree via #id::part(...) rules. */
      .title {
        margin: 0;
        font-size: 22px;
        color: #0f172a;
        letter-spacing: -0.01em;
      }

      .price {
        font-size: 34px;
        font-weight: 700;
        color: #334155;
        text-shadow: 0 1px 0 #ffffff;
      }

      /* Internal hover stays static pseudo-selector CSS. */
      .price:hover {
        color: #1d4ed8;
      }

      /* Boolean variant via reflected attribute. */
      :host([featured]) .title {
        color: #4f46e5;
      }

      @media (max-width: 991px) {
        .price {
          font-size: 28px;
        }
      }

      @media (max-width: 767px) {
        .price {
          font-size: 24px;
        }
      }
    `,
  ];

  constructor() {
    super();
    this.name = 'Starter';
    this.price = '$9/mo';
    this.featured = false;
  }

  render() {
    return html`
      <h3 class="title" part="title" data-edit="name">${this.name}</h3>
      <div class="price" part="price" data-edit="price">${this.price}</div>
      <slot name="features"></slot>
    `;
  }
}

if (!customElements.get(FixturePricingCard.grapesTagName)) {
  customElements.define(FixturePricingCard.grapesTagName, FixturePricingCard);
}
