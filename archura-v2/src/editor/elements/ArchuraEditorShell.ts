import { LitElement, css, html, unsafeCSS } from 'lit';
import { property } from 'lit/decorators.js';
import type { ArchuraEditorController } from '../ArchuraEditorController.js';
import gjsCss from 'grapesjs/dist/css/grapes.min.css?raw';
import './ArchuraToolbar.js';
import './ArchuraCanvas.js';
import './ArchuraStylingPanel.js';

export class ArchuraEditorShell extends LitElement {
  @property({ attribute: false }) controller?: ArchuraEditorController;

  override render() {
    return html`
      <div class="layout">
        <header class="header">
          <archura-toolbar .controller=${this.controller}></archura-toolbar>
        </header>
        <div class="canvas">
          <archura-canvas .controller=${this.controller}></archura-canvas>
        </div>
        <aside class="sidebar">
          <archura-styling-panel .controller=${this.controller}></archura-styling-panel>
        </aside>
      </div>
    `;
  }

  static override styles = [unsafeCSS(gjsCss), css`
    :host {
      display: block;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      grid-template-rows: auto 600px;
      gap: 16px;
    }

    .header {
      grid-column: 1 / -1;
    }

    .canvas {
      min-width: 0;
    }

    archura-canvas {
      display: block;
      height: 100%;
    }

    .sidebar {
      min-width: 0;
    }

    .gjs-cv-canvas__frames,
    .gjs-frames,
    .gjs-frame-wrapper,
    .gjs-frame {
      width: 100% !important;
      height: 100% !important;
    }
  `];
}

if (!customElements.get('archura-editor-shell')) {
  customElements.define('archura-editor-shell', ArchuraEditorShell);
}
