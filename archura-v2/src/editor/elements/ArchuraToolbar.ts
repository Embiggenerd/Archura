import { LitElement, css, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { ArchuraEditorController } from '../ArchuraEditorController.js';

export class ArchuraToolbar extends LitElement {
  @property({ attribute: false }) controller?: ArchuraEditorController;
  @state() private saving = false;

  connectedCallback(): void {
    super.connectedCallback();
    this.controller?.registerRenderable(this);
  }

  disconnectedCallback(): void {
    this.controller?.unregisterRenderable(this);
    super.disconnectedCallback();
  }

  override render() {
    const target = this.controller?.getTarget();
    return html`
      <div class="toolbar">
        <span class="breadcrumb">
          ${target
            ? html`${target.kind === 'page' ? 'Pages' : 'Components'} / <strong>${target.label}</strong>`
            : ''}
        </span>
        <button ?disabled=${this.saving} @click=${this.#save}>
          ${this.saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    `;
  }

  async #save() {
    if (!this.controller) return;
    this.saving = true;
    try {
      await this.controller.save();
    } finally {
      this.saving = false;
    }
  }

  static override styles = css`
    :host {
      display: block;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .breadcrumb {
      font: 0.9rem/1 Helvetica, Arial, sans-serif;
      color: #6b7280;
    }

    .breadcrumb strong {
      color: #111827;
    }

    button {
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 999px;
      background: white;
      color: #111827;
      padding: 10px 16px;
      font: 600 0.9rem/1 Helvetica, Arial, sans-serif;
      cursor: pointer;
    }
  `;
}

if (!customElements.get('archura-toolbar')) {
  customElements.define('archura-toolbar', ArchuraToolbar);
}
