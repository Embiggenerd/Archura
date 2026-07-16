import { html } from 'lit';
import { PageBase } from '../base/PageBase.js';
import '../heroes/Hero.js';
import '../cards/Card.js';

/**
 * A page is a code-authored composition of library components. Structure is
 * developer-owned: clients edit the components on it (traits + custom-prop
 * styles) but cannot add, remove, or move them.
 */
export class Landing extends PageBase {
  static grapesTagName = 'archura-landing';

  render() {
    return html`
      <archura-hero
        heading="Welcome to Archura"
        subheading="Everything on this page is editable — nothing on it is movable."
      ></archura-hero>
      <div style="display: flex; gap: 16px; margin-top: 16px;">
        <archura-card
          title="First Feature"
          content="Select this card to edit its content and styling."
        ></archura-card>
        <archura-card
          title="Second Feature"
          content="Each card is styled independently."
        ></archura-card>
      </div>
    `;
  }
}

if (!customElements.get(Landing.grapesTagName)) {
  customElements.define(Landing.grapesTagName, Landing);
}
