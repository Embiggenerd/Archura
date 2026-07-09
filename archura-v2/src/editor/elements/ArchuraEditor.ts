import { LitElement, css, html } from 'lit';
import { property, state } from 'lit/decorators.js';
import { ArchuraEditorController } from '../ArchuraEditorController.js';
import type { ArchuraEditorConfig } from '../types.js';
import './ArchuraEditorShell.js';

export class ArchuraEditor extends LitElement {
  @property({
    attribute: 'component-path',
    converter: (value) => value ? value.split('/') : [],
  })
  componentPath: string[] = [];

  @property({ attribute: false }) initialArtifact: ArchuraEditorConfig['initialArtifact'] = null;

  @property({ attribute: false }) components: ArchuraEditorConfig['components'] = undefined;

  @property({ attribute: false }) persistence: ArchuraEditorConfig['persistence'] = undefined;

  @state() private controller: ArchuraEditorController | null = null;

  disconnectedCallback(): void {
    this.controller?.destroy();
    this.controller = null;
    super.disconnectedCallback();
  }

  override updated(changedProperties: Map<string, unknown>): void {
    if (
      !this.controller ||
      changedProperties.has('componentPath') ||
      changedProperties.has('initialArtifact') ||
      changedProperties.has('components') ||
      changedProperties.has('persistence')
    ) {
      this.#recreateController();
      void this.controller!.init();
    }
  }

  override render() {
    if (!this.controller) return html``;
    return html`<archura-editor-shell .controller=${this.controller}></archura-editor-shell>`;
  }

  #recreateController() {
    this.controller?.destroy();
    this.controller = new ArchuraEditorController({
      componentPath: this.componentPath,
      initialArtifact: this.initialArtifact,
      components: this.components,
      persistence: this.persistence,
      onReady: () => {
        this.dispatchEvent(new CustomEvent('editorready', { detail: {} }));
      },
      onChange: (artifacts) => {
        this.dispatchEvent(new CustomEvent('artifactchange', { detail: { artifacts } }));
      },
      onSave: ({ artifacts }) => {
        this.dispatchEvent(new CustomEvent('artifactsave', { detail: { artifacts } }));
      },
      onError: (error) => {
        this.dispatchEvent(new CustomEvent('editorerror', { detail: { error } }));
      },
    });
  }

  static override styles = css`
    :host {
      display: block;
      min-height: 100%;
    }
  `;
}

if (!customElements.get('archura-editor')) {
  customElements.define('archura-editor', ArchuraEditor);
}
