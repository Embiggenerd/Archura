import grapesjs, { type Editor as GrapesEditor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import {
  createCanonicalComponentData,
  type CanonicalComponentData,
} from '../component-data/canonical.js';
import type { ArchuraEditorConfig, ArchuraEditorState, ArchuraRenderable } from './types.js';

function createDefaultHtml(componentPath: string[]) {
  const componentName = componentPath.at(-1)?.toLowerCase() ?? 'component';
  return `<section data-archura-component="${componentName}">
  <h2>${componentName}</h2>
  <p>Edit this content in the styling panel.</p>
</section>`;
}

function createDefaultCss() {
  return `section {
  display: block;
  padding: 24px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 16px;
  background: white;
  color: #111827;
  font-family: Helvetica, Arial, sans-serif;
}

h2 {
  margin: 0 0 12px;
  font-size: 1.5rem;
}

p {
  margin: 0;
  line-height: 1.5;
}`;
}

function createArtifactId(componentPath: string[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const scope = componentPath.join('-').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return `${scope || 'component'}--${timestamp}`;
}

export class ArchuraEditorController {
  #config: ArchuraEditorConfig;
  #renderables = new Set<ArchuraRenderable>();
  #state: ArchuraEditorState;
  #artifacts: CanonicalComponentData[] = [];
  #gjsEditor: GrapesEditor | null = null;
  #canvasContainer: HTMLElement | null = null;
  #stylePanelContainer: HTMLElement | null = null;
  #traitsPanelContainer: HTMLElement | null = null;
  #initScheduled = false;
  #colorPickerListener: ((e: Event) => void) | null = null;

  constructor(config: ArchuraEditorConfig = {}) {
    const componentPath = config.initialArtifact?.config.componentPath ?? config.componentPath ?? [];
    const html = config.initialArtifact?.snapshot.html ?? createDefaultHtml(componentPath);
    const css = config.initialArtifact?.snapshot.css ?? createDefaultCss();

    this.#config = config;
    this.#state = {
      componentPath,
      html,
      css,
      ready: false,
    };
  }

  async init(): Promise<void> {
    if (this.#state.ready) {
      return;
    }

    this.#state = {
      ...this.#state,
      ready: true,
    };
    this.#config.onReady?.();
    this.#notify();
  }

  render(container: HTMLElement): void {
    if (!container) {
      throw new Error('A container is required to render the editor.');
    }

    const element = document.createElement('archura-editor-shell') as HTMLElement & {
      controller?: ArchuraEditorController;
    };
    element.controller = this;
    container.replaceChildren(element);
  }

  save(): Promise<CanonicalComponentData[]> {
    this.#artifacts = [this.#createCurrentArtifact()];
    this.#config.onSave?.({ artifacts: this.#artifacts });
    this.#config.onChange?.(this.#artifacts);
    this.#notify();

    return Promise.resolve(this.#artifacts);
  }

  getArtifacts(): CanonicalComponentData[] {
    return [...this.#artifacts];
  }

  async loadArtifact(artifact: CanonicalComponentData): Promise<void> {
    this.#state = {
      componentPath: [...artifact.config.componentPath],
      html: artifact.snapshot.html,
      css: artifact.snapshot.css,
      ready: this.#state.ready,
    };
    this.#artifacts = [artifact];
    this.#config.onChange?.(this.#artifacts);
    this.#notify();
  }

  mountCanvas(container: HTMLElement): void {
    if (this.#gjsEditor) return;
    this.#canvasContainer = container;
    this.#scheduleInit();
  }

  mountStylePanel(container: HTMLElement): void {
    if (this.#gjsEditor) return;
    this.#stylePanelContainer = container;
    this.#scheduleInit();
  }

  mountTraitsPanel(container: HTMLElement): void {
    if (this.#gjsEditor) return;
    this.#traitsPanelContainer = container;
    this.#scheduleInit();
  }

  #scheduleInit(): void {
    if (this.#initScheduled || this.#gjsEditor || !this.#canvasContainer) return;
    this.#initScheduled = true;
    Promise.resolve().then(() => {
      this.#initScheduled = false;
      if (!this.#gjsEditor && this.#canvasContainer) {
        this.#initEditor();
      }
    });
  }

  #initEditor(): void {
    const container = this.#canvasContainer!;
    const componentPath = [...this.#state.componentPath];
    container.style.cssText = 'width:100%;height:100%;';

    this.#gjsEditor = grapesjs.init({
      container,
      height: '100%',
      width: '100%',
      storageManager: false,
      panels: { defaults: [] },
      deviceManager: {
        devices: [{ name: 'Desktop', width: '' }],
      },
      colorPicker: { appendTo: 'body' },
      ...(this.#traitsPanelContainer && {
        traitManager: { appendTo: this.#traitsPanelContainer },
      }),
      ...(this.#stylePanelContainer && {
        styleManager: {
          appendTo: this.#stylePanelContainer,
          sectors: [
            {
              name: 'Typography',
              open: true,
              properties: ['font-family', 'font-size', 'font-weight', 'color', 'line-height', 'text-align'],
            },
            {
              name: 'Spacing',
              properties: ['padding', 'margin'],
            },
            {
              name: 'Dimension',
              properties: ['width', 'height', 'max-width'],
            },
            {
              name: 'Decorations',
              properties: ['background-color', 'border-radius', 'border'],
            },
          ],
        },
      }),
      plugins: componentPath.length > 0
        ? [(editor) => this.#componentPlugin(editor, componentPath)]
        : [],
    });

    const gjsEl = container.querySelector<HTMLElement>('.gjs-editor');
    if (gjsEl) gjsEl.style.height = '100%';
    const gjsCanvas = container.querySelector<HTMLElement>('.gjs-cv-canvas');
    if (gjsCanvas) gjsCanvas.style.cssText = 'top:0;left:0;right:0;bottom:0;width:100%;height:100%;';

    this.#setupColorPickerFix();
  }

  #setupColorPickerFix(): void {
    this.#colorPickerListener = (e: Event) => {
      const path = e.composedPath() as HTMLElement[];
      const trigger = path.find(el => el?.classList?.contains('gjs-field-color-picker'));
      if (!trigger) return;
      setTimeout(() => {
        const sp = document.querySelector<HTMLElement>('.sp-container:not(.sp-hidden)');
        if (!sp) return;
        const rect = trigger.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        const pw = sp.offsetWidth;
        const ph = sp.offsetHeight;
        let left = rect.left + window.scrollX;
        let top = rect.bottom + window.scrollY;
        if (left + pw > window.innerWidth) left = rect.right - pw + window.scrollX;
        if (top + ph > window.innerHeight) top = rect.top - ph + window.scrollY;
        sp.style.top = top + 'px';
        sp.style.left = left + 'px';
      }, 0);
    };
    document.addEventListener('click', this.#colorPickerListener, true);
  }

  #componentPlugin(editor: GrapesEditor, componentPath: string[]): void {
    const moduleUrl = `/src/components/${componentPath.join('/')}.js`;
    const tagName = `archura-${componentPath.at(-1)!.toLowerCase()}`;

    editor.Components.addType(tagName, {
      isComponent: (el: Element) => el.tagName?.toLowerCase() === tagName,
      model: {
        defaults: {
          tagName,
          draggable: true,
          droppable: false,
          stylable: true,
        },
      },
    });

    editor.on('load', () => {
      const canvasDocument = editor.Canvas.getDocument();
      if (!canvasDocument) return;

      const script = canvasDocument.createElement('script');
      script.type = 'module';
      script.src = moduleUrl;
      script.onload = () => {
        const iframeWindow = canvasDocument.defaultView as (Window & { customElements: CustomElementRegistry }) | null;
        type LitCtor = CustomElementConstructor & { properties?: Record<string, { type?: unknown }> };
        const ctor = iframeWindow?.customElements.get(tagName) as LitCtor | undefined;

        // Use own static properties only (not inherited) to avoid showing base-class internals
        const ownProps = ctor?.properties ? Object.entries(ctor.properties) : [];

        // Create a detached instance to read constructor default values
        const tempEl = canvasDocument.createElement(tagName) as HTMLElement & Record<string, unknown>;

        const traits = ownProps
          .filter(([, cfg]) => {
            // Use .name comparison to avoid cross-realm (iframe vs main window) === failure
            const n = (cfg.type as { name?: string } | undefined)?.name;
            return !cfg.type || n === 'String' || n === 'Number' || n === 'Boolean';
          })
          .map(([name, cfg]) => {
            const n = (cfg.type as { name?: string } | undefined)?.name;
            const defaultVal = tempEl[name];
            return {
              type: n === 'Number' ? 'number' : n === 'Boolean' ? 'checkbox' : 'text',
              name,
              label: name.charAt(0).toUpperCase() + name.slice(1),
              value: defaultVal !== undefined ? String(defaultVal) : '',
            };
          });

        if (traits.length > 0) {
          editor.Components.addType(tagName, { model: { defaults: { traits } } });
        }

        // Render with default attribute values so GrapesJS picks them up
        const attrs = traits
          .filter(t => t.value !== '')
          .map(t => `${t.name}="${t.value}"`)
          .join(' ');
        editor.setComponents(`<${tagName}${attrs ? ' ' + attrs : ''}></${tagName}>`);
        this.#notify();
      };
      canvasDocument.head.appendChild(script);
    });

    editor.on('component:update', () => this.#notify());
    editor.on('style:change', () => this.#notify());
  }

  destroy(): void {
    if (this.#colorPickerListener) {
      document.removeEventListener('click', this.#colorPickerListener, true);
      this.#colorPickerListener = null;
    }
    this.#gjsEditor?.destroy();
    this.#gjsEditor = null;
    this.#renderables.clear();
  }

  registerRenderable(renderable: ArchuraRenderable): void {
    this.#renderables.add(renderable);
  }

  unregisterRenderable(renderable: ArchuraRenderable): void {
    this.#renderables.delete(renderable);
  }

  getState(): ArchuraEditorState {
    return {
      componentPath: [...this.#state.componentPath],
      html: this.#gjsEditor?.getHtml() ?? this.#state.html,
      css: this.#gjsEditor?.getCss() ?? this.#state.css,
      ready: this.#state.ready,
    };
  }

  updateHtml(html: string): void {
    this.#state = {
      ...this.#state,
      html,
    };
    this.#emitChange();
  }

  updateCss(css: string): void {
    this.#state = {
      ...this.#state,
      css,
    };
    this.#emitChange();
  }

  #emitChange() {
    this.#config.onChange?.([this.#createCurrentArtifact()]);
    this.#notify();
  }

  #notify() {
    for (const renderable of this.#renderables) {
      renderable.requestUpdate();
    }
  }

  #createCurrentArtifact(): CanonicalComponentData {
    const timestamp = new Date().toISOString();

    return createCanonicalComponentData({
      id: createArtifactId(this.#state.componentPath),
      type: 'component-instance',
      content: {},
      snapshot: {
        html: this.#state.html,
        css: this.#state.css,
      },
      config: {
        componentPath: [...this.#state.componentPath],
      },
      meta: {
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
  }
}
