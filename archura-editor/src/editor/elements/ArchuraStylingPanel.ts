import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import type { ArchuraEditorController } from '../ArchuraEditorController.js';

export class ArchuraStylingPanel extends LitElement {
  @property({ attribute: false }) controller?: ArchuraEditorController;
  #mountedController: ArchuraEditorController | null = null;

  override createRenderRoot() {
    return this;
  }

  override render() {
    return html`
      <div class="traits-root"></div>
      <div class="style-manager-root"></div>
    `;
  }

  override updated(): void {
    if (!this.controller || this.controller === this.#mountedController) return;
    const traitsContainer = this.querySelector<HTMLElement>('.traits-root');
    const styleContainer = this.querySelector<HTMLElement>('.style-manager-root');
    if (!traitsContainer || !styleContainer) return;
    this.#mountedController = this.controller;
    this.controller.mountTraitsPanel(traitsContainer);
    this.controller.mountStylePanel(styleContainer);
  }
}

if (!customElements.get('archura-styling-panel')) {
  customElements.define('archura-styling-panel', ArchuraStylingPanel);
}
