import { LitElement, css, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import type { ArchuraEditorController } from '../ArchuraEditorController.js';
import { GOOGLE_FONTS } from '../ArchuraEditorController.js';

type PublishState = 'idle' | 'publishing' | 'published' | 'failed';

const PUBLISH_LABELS: Record<PublishState, string> = {
  idle: 'Publish',
  publishing: 'Publishing...',
  published: 'Published',
  failed: 'Publish failed',
};

const DEVICES = ['Desktop', 'Tablet', 'Mobile'];

export class ArchuraToolbar extends LitElement {
  @property({ attribute: false }) controller?: ArchuraEditorController;
  @state() private saving = false;
  @state() private publishState: PublishState = 'idle';
  @state() private openPanel: 'none' | 'theme' | 'page' | 'targets' | 'breakpoints' = 'none';
  #resetTimer?: ReturnType<typeof setTimeout>;

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
    const device = this.controller?.getDevice() ?? 'Desktop';
    return html`
      <div class="toolbar">
        <span class="breadcrumb">
          ${target
            ? html`
                <button class="crumb" @click=${() => this.#togglePanel('targets')}>
                  ${target.kind === 'page' ? 'Pages' : 'Components'} / <strong>${target.label}</strong>
                  <span class="caret">▾</span>
                </button>
              `
            : ''}
          ${this.controller?.getActivePart()
            ? html`
                <span class="part-chip">
                  › ${this.controller.getActivePart()}
                  <button class="chip-close" title="Back to component" @click=${() => this.controller?.clearActivePart()}>
                    ✕
                  </button>
                </span>
              `
            : ''}
          ${this.controller?.dirty
            ? html`<span class="dirty" title="Unsaved changes">●</span>`
            : ''}
        </span>
        <span class="devices">
          ${DEVICES.map(
            (name) => html`
              <button
                class=${device === name ? 'active' : ''}
                @click=${() => this.controller?.setDevice(name)}
              >
                ${name}
              </button>
            `
          )}
          ${this.controller?.isDeviceWidthAdjustable()
            ? html`
                <span class="width-control" title="Preview width (drag or type)">
                  <input
                    type="number"
                    class="width-input"
                    .value=${String(this.controller.getDeviceWidth() ?? '')}
                    @change=${(e: Event) =>
                      this.controller?.setDeviceWidth(Number((e.target as HTMLInputElement).value))}
                  />
                  <span class="width-unit">px</span>
                </span>
              `
            : ''}
        </span>
        <span class="actions">
          <button title="Undo" @click=${() => this.controller?.undo()}>↩</button>
          <button title="Redo" @click=${() => this.controller?.redo()}>↪</button>
          <button class=${this.openPanel === 'theme' ? 'active' : ''} @click=${() => this.#togglePanel('theme')}>
            Theme
          </button>
          <button class=${this.openPanel === 'page' ? 'active' : ''} @click=${() => this.#togglePanel('page')}>
            Page
          </button>
          <button
            class=${this.openPanel === 'breakpoints' ? 'active' : ''}
            @click=${() => this.#togglePanel('breakpoints')}
          >
            Breakpoints
          </button>
          ${this.controller?.canPublish
            ? html`
                <button
                  class="primary ${this.publishState === 'failed' ? 'failed' : ''}"
                  ?disabled=${this.publishState === 'publishing'}
                  @click=${this.#publish}
                >
                  ${PUBLISH_LABELS[this.publishState]}
                </button>
              `
            : html`
                <button class="primary" ?disabled=${this.saving} @click=${this.#save}>
                  ${this.saving ? 'Saving...' : 'Save'}
                </button>
              `}
        </span>
      </div>
      ${this.openPanel === 'theme' ? this.#renderThemePanel() : ''}
      ${this.openPanel === 'page' ? this.#renderPagePanel() : ''}
      ${this.openPanel === 'targets' ? this.#renderTargetsPanel() : ''}
      ${this.openPanel === 'breakpoints' ? this.#renderBreakpointsPanel() : ''}
    `;
  }

  #togglePanel(panel: 'theme' | 'page' | 'targets' | 'breakpoints') {
    this.openPanel = this.openPanel === panel ? 'none' : panel;
  }

  #renderTargetsPanel() {
    const definitions = this.controller?.getComponents() ?? [];
    const current = this.controller?.getTarget();
    const group = (kind: 'page' | 'component', heading: string) => {
      const items = definitions.filter((d) => d.kind === kind);
      if (items.length === 0) return '';
      return html`
        <div class="targets-group">${heading}</div>
        ${items.map(
          (def) => html`
            <button
              class="target ${current?.path.join('/') === def.path.join('/') ? 'current' : ''}"
              @click=${() => this.#selectTarget(def.path)}
            >
              ${def.label ?? def.path.at(-1)}
            </button>
          `
        )}
      `;
    };
    return html`<div class="panel left targets">${group('page', 'Pages')} ${group('component', 'Components')}</div>`;
  }

  #renderBreakpointsPanel() {
    const breakpoints = this.controller?.getBreakpoints() ?? [];
    return html`
      <div class="panel">
        <div class="targets-group">Breakpoints (max-width)</div>
        ${breakpoints.map(
          (bp) => html`
            <label>
              ${bp.name}
              <span class="width-control">
                <input
                  type="number"
                  class="width-input"
                  .value=${live(String(bp.maxWidth))}
                  @change=${(e: Event) =>
                    this.controller?.setBreakpointWidth(bp.name, Number((e.target as HTMLInputElement).value))}
                />
                <span class="width-unit">px</span>
              </span>
            </label>
          `
        )}
        <p class="hint">Changing a breakpoint moves all its styles to the new width.</p>
      </div>
    `;
  }

  #selectTarget(path: string[]) {
    this.openPanel = 'none';
    this.dispatchEvent(
      new CustomEvent('archura:target-select', {
        detail: { path },
        bubbles: true,
        composed: true,
      })
    );
  }

  #renderThemePanel() {
    const tokens = this.controller?.getThemeTokens() ?? {};
    const fontValue = tokens['--font-family'] ?? '';
    return html`
      <div class="panel">
        <label>
          Background
          <input
            type="color"
            .value=${tokens['--background-color'] ?? '#ffffff'}
            @input=${(e: Event) => this.#setToken('--background-color', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Text color
          <input
            type="color"
            .value=${tokens['--color'] ?? '#111827'}
            @input=${(e: Event) => this.#setToken('--color', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Radius
          <input
            type="text"
            placeholder="12px"
            .value=${tokens['--border-radius'] ?? ''}
            @change=${(e: Event) => this.#setToken('--border-radius', (e.target as HTMLInputElement).value)}
          />
        </label>
        <label>
          Font
          <select @change=${(e: Event) => this.#setToken('--font-family', (e.target as HTMLSelectElement).value)}>
            <option value="" ?selected=${!fontValue}>Default</option>
            ${GOOGLE_FONTS.map(
              (f) => html`
                <option value="'${f}', sans-serif" ?selected=${fontValue.includes(f)}>${f}</option>
              `
            )}
          </select>
        </label>
      </div>
    `;
  }

  #renderPagePanel() {
    const meta = this.controller?.getPageMeta() ?? {};
    return html`
      <div class="panel">
        <label>
          Page title
          <input
            type="text"
            .value=${meta.title ?? ''}
            @change=${(e: Event) => this.controller?.setPageMeta({ title: (e.target as HTMLInputElement).value })}
          />
        </label>
        <label>
          Description
          <input
            type="text"
            .value=${meta.description ?? ''}
            @change=${(e: Event) =>
              this.controller?.setPageMeta({ description: (e.target as HTMLInputElement).value })}
          />
        </label>
      </div>
    `;
  }

  #setToken(prop: string, value: string) {
    this.controller?.setThemeTokens({ [prop]: value });
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

  async #publish() {
    if (!this.controller) return;
    clearTimeout(this.#resetTimer);
    this.publishState = 'publishing';
    try {
      await this.controller.publish();
      this.publishState = 'published';
    } catch {
      // The controller already routed the error through onError
      this.publishState = 'failed';
    }
    this.#resetTimer = setTimeout(() => {
      this.publishState = 'idle';
    }, 2000);
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      font-family: Helvetica, Arial, sans-serif;
    }

    /* 3-column grid: the breadcrumb (and its part chip) grows inside the
       left cell without pushing the device switcher or actions */
    .toolbar {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 12px;
    }

    .breadcrumb {
      justify-self: start;
      min-width: 0;
      white-space: nowrap;
      font: 0.9rem/1 Helvetica, Arial, sans-serif;
      color: #6b7280;
    }

    .devices {
      justify-self: center;
    }

    .actions {
      justify-self: end;
    }

    .breadcrumb strong {
      color: #111827;
    }

    .crumb {
      border: none;
      background: none;
      padding: 4px 6px;
      font: inherit;
      color: inherit;
      cursor: pointer;
      border-radius: 6px;
    }

    .crumb:hover {
      background: #f3f4f6;
    }

    .caret {
      font-size: 0.7rem;
      color: #9ca3af;
    }

    .panel.left {
      left: 0;
      right: auto;
    }

    .panel.targets {
      gap: 2px;
      min-width: 180px;
    }

    .targets-group {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #9ca3af;
      margin: 6px 0 2px;
    }

    .target {
      border: none;
      background: none;
      border-radius: 6px;
      padding: 7px 8px;
      font: 0.9rem/1 Helvetica, Arial, sans-serif;
      color: #111827;
      text-align: left;
      cursor: pointer;
    }

    .target:hover {
      background: #f3f4f6;
    }

    .target.current {
      background: #eef2ff;
      color: #3730a3;
      font-weight: 600;
    }

    .dirty {
      color: #f59e0b;
      margin-left: 6px;
    }

    .part-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
      padding: 3px 8px;
      background: #eef2ff;
      border: 1px solid #c7d2fe;
      border-radius: 999px;
      color: #3730a3;
      font-size: 0.8rem;
    }

    .chip-close {
      border: none;
      background: none;
      padding: 0 2px;
      font-size: 0.75rem;
      color: #3730a3;
      cursor: pointer;
    }

    .devices,
    .actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .width-control {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-left: 4px;
      padding: 2px 6px;
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 999px;
    }

    .width-input {
      width: 46px;
      border: none;
      background: none;
      font: 600 0.8rem/1 Helvetica, Arial, sans-serif;
      color: #111827;
      text-align: right;
      -moz-appearance: textfield;
      appearance: textfield;
    }

    .width-input::-webkit-outer-spin-button,
    .width-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .width-unit {
      font-size: 0.75rem;
      color: #9ca3af;
    }

    .hint {
      margin: 6px 0 0;
      font-size: 0.75rem;
      color: #9ca3af;
      max-width: 220px;
    }

    button {
      border: 1px solid rgba(15, 23, 42, 0.12);
      border-radius: 999px;
      background: white;
      color: #111827;
      padding: 8px 14px;
      font: 600 0.85rem/1 Helvetica, Arial, sans-serif;
      cursor: pointer;
    }

    button.active {
      background: #111827;
      color: white;
    }

    button.primary {
      padding: 10px 16px;
    }

    button.failed {
      border-color: #dc2626;
      color: #dc2626;
    }

    .panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 20;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      min-width: 240px;
    }

    .panel label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      font-size: 0.85rem;
      color: #374151;
    }

    .panel input[type='text'],
    .panel select {
      width: 140px;
      padding: 6px 8px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 0.85rem;
    }
  `;
}

if (!customElements.get('archura-toolbar')) {
  customElements.define('archura-toolbar', ArchuraToolbar);
}
