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
      height: 100%;
    }

    /* Fill whatever height the host gives; keep a workable floor for
       hosts that give none */
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 16px;
      height: 100%;
      min-height: 640px;
    }

    .header {
      grid-column: 1 / -1;
    }

    .canvas {
      min-width: 0;
      min-height: 0;
    }

    archura-canvas {
      display: block;
      height: 100%;
    }

    /* The sidebar is an independent tool column: full editor height,
       scrolling its own content regardless of canvas size */
    .sidebar {
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
    }

    .gjs-cv-canvas__frames,
    .gjs-frames,
    .gjs-frame-wrapper,
    .gjs-frame {
      width: 100% !important;
      height: 100% !important;
    }

    /* Resize affordance: edge handles are full-length strips (drag the
       edge), not 10px dots; corners stay as generous invisible squares */
    .gjs-resizer-h-cl,
    .gjs-resizer-h-cr {
      top: 10px !important;
      bottom: 10px !important;
      height: auto !important;
      margin: 0 !important;
      transform: none !important;
      width: 10px !important;
      border: none !important;
      border-radius: 3px !important;
      background: transparent !important;
      cursor: col-resize;
    }

    .gjs-resizer-h-cr {
      right: -6px !important;
    }

    .gjs-resizer-h-cl {
      left: -6px !important;
    }

    .gjs-resizer-h-tc,
    .gjs-resizer-h-bc {
      left: 10px !important;
      right: 10px !important;
      width: auto !important;
      margin: 0 !important;
      transform: none !important;
      height: 10px !important;
      border: none !important;
      border-radius: 3px !important;
      background: transparent !important;
      cursor: row-resize;
    }

    .gjs-resizer-h-tc {
      top: -6px !important;
    }

    .gjs-resizer-h-bc {
      bottom: -6px !important;
    }

    .gjs-resizer-h-tl,
    .gjs-resizer-h-tr,
    .gjs-resizer-h-bl,
    .gjs-resizer-h-br {
      width: 14px !important;
      height: 14px !important;
      border: none !important;
      border-radius: 3px !important;
      background: transparent !important;
      z-index: 2;
    }

    .gjs-resizer-h-tl,
    .gjs-resizer-h-br {
      cursor: nwse-resize;
    }

    .gjs-resizer-h-tr,
    .gjs-resizer-h-bl {
      cursor: nesw-resize;
    }

    .gjs-resizer-h:hover {
      background: rgba(59, 130, 246, 0.4) !important;
    }
  `];
}

if (!customElements.get('archura-editor-shell')) {
  customElements.define('archura-editor-shell', ArchuraEditorShell);
}
