import { html } from 'lit';
import { PageBase } from '../base/PageBase.js';
import '../heroes/Hero.js';
import '../cards/Card.js';

/**
 * Landing page built around freely resizable cards. Each card pins
 * `flex: 0 0 auto`, so a dragged width is honored exactly instead of being
 * renegotiated by the flex row; the row wraps when cards outgrow it.
 */
export class Cards extends PageBase {
  static grapesTagName = 'archura-cards';

  render() {
    return html`
      <archura-hero
        heading="Resizable Cards"
        subheading="Select a card, then drag any edge or corner to resize it."
      ></archura-hero>
      <div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 16px; margin-top: 16px;">
        <archura-card
          style="flex: 0 0 auto; --width: 31%;"
          title="Drag me"
          content="Grab my right edge and pull."
        ></archura-card>
        <archura-card
          style="flex: 0 0 auto; --width: 31%;"
          title="Me too"
          content="My width sticks exactly where you drop it."
        ></archura-card>
        <archura-card
          style="flex: 0 0 auto; --width: 31%;"
          title="And me"
          content="The row wraps when we outgrow it."
        ></archura-card>
      </div>
    `;
  }
}

if (!customElements.get(Cards.grapesTagName)) {
  customElements.define(Cards.grapesTagName, Cards);
}
