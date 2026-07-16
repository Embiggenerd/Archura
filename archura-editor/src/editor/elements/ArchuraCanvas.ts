import { LitElement, html } from 'lit';
import { property } from 'lit/decorators.js';
import type { ArchuraEditorController } from '../ArchuraEditorController.js';

export class ArchuraCanvas extends LitElement {
  @property({ attribute: false }) controller?: ArchuraEditorController;
  #mountedController: ArchuraEditorController | null = null;

  override createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.controller?.registerRenderable(this);
  }

  disconnectedCallback(): void {
    this.controller?.unregisterRenderable(this);
    super.disconnectedCallback();
  }

  override render() {
    return html`<div class="gjs-container"></div>`;
  }

  override updated(): void {
    if (!this.controller || this.controller === this.#mountedController) return;
    const container = this.querySelector<HTMLElement>('.gjs-container');
    if (!container) return;
    this.#mountedController = this.controller;
    this.controller.mountCanvas(container);
  }
}

if (!customElements.get('archura-canvas')) {
  customElements.define('archura-canvas', ArchuraCanvas);
}
