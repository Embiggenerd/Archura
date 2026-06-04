import { LitElement, css, html } from 'lit';
import { property } from 'lit/decorators.js';

export class BuilderButtonLit extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'open' as const };

  @property({ type: String, reflect: true }) label = 'Button';

  override render() {
    return html`<button class="button" type="button">${this.label}</button>`;
  }

  static override styles = css`
    :host {
      display: inline-block;
      --button-bg: #c4672d;
      --button-ink: #ffffff;
      --button-border-color: transparent;
      --button-padding-inline: 1.25rem;
      --button-radius: 999px;
      --button-min-height: 2.75rem;
      font: inherit;
    }

    .button {
      min-height: var(--button-min-height);
      padding: 0 var(--button-padding-inline);
      border-radius: var(--button-radius);
      border: 1px solid var(--button-border-color);
      background: var(--button-bg);
      color: var(--button-ink);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
  `;
}

if (!customElements.get('builder-button-lit')) {
  customElements.define('builder-button-lit', BuilderButtonLit);
}
