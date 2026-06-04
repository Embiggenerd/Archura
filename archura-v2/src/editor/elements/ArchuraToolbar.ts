import { LitElement, css, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { ArchuraEditorController } from '../ArchuraEditorController.js';

export class ArchuraToolbar extends LitElement {
  @property({ attribute: false }) controller?: ArchuraEditorController;
  @state() private saving = false;

  override render() {
    return html`
      <div class="toolbar">
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
      gap: 12px;
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
