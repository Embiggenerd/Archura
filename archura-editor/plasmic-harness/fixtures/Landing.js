// Hand-written stand-in for a compiled Plasmic page (Step 0). The page's
// layout CSS is emitted as a <style> child of the light-DOM render — the
// spike asks whether that survives expansion, GrapesJS parsing, save,
// reload, and publish. Wrappers are plain divs/sections (structure-locked);
// only the generated pricing-card leaves are Archura-selectable.
import { html } from 'lit';
import { PageBase } from '../../src/components/base/PageBase.js';
import './PricingCard.js';

export class FixtureLanding extends PageBase {
  static grapesTagName = 'archura-fixture-landing-m7p4w8';

  render() {
    return html`
      <style>
        .fx-hero {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 56px 24px;
          background: #0f172a;
          color: #f8fafc;
        }
        .fx-hero h1 {
          margin: 0;
          font-size: 40px;
        }
        .fx-free {
          position: absolute;
          top: 16px;
          right: 24px;
          font-size: 28px;
        }
        .fx-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          padding: 32px 24px;
        }
        @media (max-width: 991px) {
          .fx-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 767px) {
          .fx-grid {
            grid-template-columns: 1fr;
          }
          .fx-hero h1 {
            font-size: 28px;
          }
        }
      </style>
      <section class="fx-hero">
        <h1>Fixture Landing</h1>
        <p>Hand-written stand-in for a compiled Plasmic page.</p>
        <div class="fx-free">✦</div>
      </section>
      <div class="fx-grid">
        <archura-fixture-pricingcard-k3x9q2 name="Starter" price="$9/mo"></archura-fixture-pricingcard-k3x9q2>
        <archura-fixture-pricingcard-k3x9q2 name="Growth" price="$29/mo" featured></archura-fixture-pricingcard-k3x9q2>
        <archura-fixture-pricingcard-k3x9q2 name="Scale" price="$99/mo"></archura-fixture-pricingcard-k3x9q2>
      </div>
    `;
  }
}

if (!customElements.get(FixtureLanding.grapesTagName)) {
  customElements.define(FixtureLanding.grapesTagName, FixtureLanding);
}
