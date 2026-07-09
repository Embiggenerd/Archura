import grapesjs, { type Editor as GrapesEditor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import {
  createCanonicalComponentData,
  type CanonicalComponentData,
} from '../component-data/canonical.js';
import { defaultComponents } from '../components/index.js';
import type {
  ArchuraComponentDefinition,
  ArchuraEditTarget,
  ArchuraEditorConfig,
  ArchuraEditorState,
  ArchuraRenderable,
} from './types.js';

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

export const BASE_RESET_CSS = `*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; }`;

export function transformForDeployment(html: string, css: string): { html: string; css: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(css);
  } catch {
    return { html, css };
  }

  const keptRules: string[] = [];
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSStyleRule)) {
      keptRules.push(rule.cssText);
      continue;
    }

    // Read names from cssText: some engines don't enumerate custom props by index
    const propNames = [...rule.style.cssText.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);

    let targets: HTMLElement[] = [];
    if (propNames.length > 0) {
      try {
        targets = [...doc.querySelectorAll<HTMLElement>(rule.selectorText)];
      } catch {
        targets = [];
      }
    }

    if (targets.length > 0) {
      for (const prop of propNames) {
        const value = rule.style.getPropertyValue(prop);
        for (const el of targets) {
          el.style.setProperty(prop, value);
        }
        rule.style.removeProperty(prop);
      }
    }

    if (rule.style.cssText.trim() !== '') {
      keptRules.push(rule.cssText);
    }
  }

  return { html: doc.body.innerHTML, css: keptRules.join('\n') };
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
  #hasSnapshot = false;
  #components: ArchuraComponentDefinition[];
  #definition: ArchuraComponentDefinition | null = null;

  constructor(config: ArchuraEditorConfig = {}) {
    const componentPath = config.initialArtifact?.config.componentPath ?? config.componentPath ?? [];
    this.#components = config.components ?? defaultComponents;
    this.#definition = this.#resolveDefinition(componentPath);
    const html = config.initialArtifact?.snapshot.html ?? createDefaultHtml(componentPath);
    const css = config.initialArtifact?.snapshot.css ?? createDefaultCss();

    this.#config = config;
    this.#hasSnapshot = !!config.initialArtifact;
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
    this.#hasSnapshot = true;
    this.#definition = this.#resolveDefinition(this.#state.componentPath);
    this.#artifacts = [artifact];
    this.#applySnapshot();
    this.#config.onChange?.(this.#artifacts);
    this.#notify();
  }

  #resolveDefinition(componentPath: string[]): ArchuraComponentDefinition | null {
    if (componentPath.length === 0) return null;
    const key = componentPath.join('/');
    return this.#components.find((definition) => definition.path.join('/') === key) ?? null;
  }

  #applySnapshot(): void {
    const editor = this.#gjsEditor;
    if (!editor) return;
    // setStyle first: it replaces all CssComposer rules, including the ones
    // setComponents derives from inline styles in the snapshot html
    editor.setStyle(this.#state.css);
    editor.setComponents(this.#state.html);
    if (this.#definition?.kind === 'page') this.#lockStructure(editor);
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
    const definition = this.#definition;
    container.style.cssText = 'width:100%;height:100%;';

    if (this.#state.componentPath.length > 0 && !definition) {
      this.#config.onError?.(
        new Error(`No registered component definition for "${this.#state.componentPath.join('/')}"`)
      );
    }

    this.#gjsEditor = grapesjs.init({
      container,
      height: '100%',
      width: '100%',
      storageManager: false,
      protectedCss: BASE_RESET_CSS,
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
              properties: [
                {
                  label: 'Font Family',
                  property: '--font-family',
                  type: 'select',
                  options: [
                    { id: 'system-ui, -apple-system, sans-serif', label: 'System UI' },
                    { id: 'Arial, Helvetica, sans-serif', label: 'Arial' },
                    { id: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
                    { id: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
                    { id: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
                    { id: "'Trebuchet MS', sans-serif", label: 'Trebuchet MS' },
                    { id: "'Times New Roman', Times, serif", label: 'Times New Roman' },
                    { id: 'Georgia, serif', label: 'Georgia' },
                    { id: 'Garamond, serif', label: 'Garamond' },
                    { id: "'Courier New', Courier, monospace", label: 'Courier New' },
                    { id: 'monospace', label: 'Monospace' },
                  ],
                },
                { label: 'Font Size', property: '--font-size', type: 'number', units: ['px', 'rem', 'em'] },
                {
                  label: 'Font Weight',
                  property: '--font-weight',
                  type: 'select',
                  options: [
                    { id: '300', label: 'Light' },
                    { id: '400', label: 'Normal' },
                    { id: '600', label: 'Semibold' },
                    { id: '700', label: 'Bold' },
                  ],
                },
                { label: 'Color', property: '--color', type: 'color' },
                { label: 'Line Height', property: '--line-height', type: 'number', units: ['', 'px'] },
                { label: 'Letter Spacing', property: '--letter-spacing', type: 'number', units: ['px', 'em', 'rem'] },
                {
                  label: 'Text Align',
                  property: '--text-align',
                  type: 'select',
                  options: [
                    { id: 'left', label: 'Left' },
                    { id: 'center', label: 'Center' },
                    { id: 'right', label: 'Right' },
                    { id: 'justify', label: 'Justify' },
                  ],
                },
                {
                  label: 'Font Style',
                  property: '--font-style',
                  type: 'select',
                  options: [
                    { id: 'normal', label: 'Normal' },
                    { id: 'italic', label: 'Italic' },
                    { id: 'oblique', label: 'Oblique' },
                  ],
                },
                {
                  label: 'Text Decoration',
                  property: '--text-decoration',
                  type: 'select',
                  options: [
                    { id: 'none', label: 'None' },
                    { id: 'underline', label: 'Underline' },
                    { id: 'line-through', label: 'Line Through' },
                    { id: 'overline', label: 'Overline' },
                  ],
                },
                { label: 'Text Shadow', property: '--text-shadow', type: 'base' },
              ],
            },
            {
              name: 'Spacing',
              properties: [
                { label: 'Padding', property: '--padding', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Padding Top', property: '--padding-top', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Padding Right', property: '--padding-right', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Padding Bottom', property: '--padding-bottom', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Padding Left', property: '--padding-left', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Margin', property: '--margin', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Margin Top', property: '--margin-top', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Margin Right', property: '--margin-right', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Margin Bottom', property: '--margin-bottom', type: 'number', units: ['px', 'rem', 'em', '%'] },
                { label: 'Margin Left', property: '--margin-left', type: 'number', units: ['px', 'rem', 'em', '%'] },
              ],
            },
            {
              name: 'Dimension',
              properties: [
                { label: 'Width', property: '--width', type: 'number', units: ['px', '%', 'rem', 'em', 'vw'] },
                { label: 'Height', property: '--height', type: 'number', units: ['px', '%', 'rem', 'em', 'vh'] },
                { label: 'Max Width', property: '--max-width', type: 'number', units: ['px', '%', 'rem', 'em', 'vw'] },
                { label: 'Min Height', property: '--min-height', type: 'number', units: ['px', '%', 'rem', 'em', 'vh'] },
              ],
            },
            {
              name: 'Decorations',
              properties: [
                { label: 'Background', property: '--background-color', type: 'color' },
                { label: 'Border Radius', property: '--border-radius', type: 'number', units: ['px', '%', 'rem'] },
                { label: 'Border', property: '--border', type: 'base' },
                { label: 'Box Shadow', property: '--box-shadow', type: 'base' },
                { label: 'Opacity', property: '--opacity', type: 'number', units: [''] },
              ],
            },
            {
              name: 'Flex',
              properties: [
                {
                  label: 'Display',
                  property: '--display',
                  type: 'select',
                  options: [
                    { id: 'block', label: 'Block' },
                    { id: 'flex', label: 'Flex' },
                    { id: 'inline-flex', label: 'Inline Flex' },
                    { id: 'inline-block', label: 'Inline Block' },
                    { id: 'none', label: 'None' },
                  ],
                },
                {
                  label: 'Flex Direction',
                  property: '--flex-direction',
                  type: 'select',
                  options: [
                    { id: 'row', label: 'Row' },
                    { id: 'row-reverse', label: 'Row Reverse' },
                    { id: 'column', label: 'Column' },
                    { id: 'column-reverse', label: 'Column Reverse' },
                  ],
                },
                {
                  label: 'Flex Wrap',
                  property: '--flex-wrap',
                  type: 'select',
                  options: [
                    { id: 'nowrap', label: 'No Wrap' },
                    { id: 'wrap', label: 'Wrap' },
                    { id: 'wrap-reverse', label: 'Wrap Reverse' },
                  ],
                },
                {
                  label: 'Justify Content',
                  property: '--justify-content',
                  type: 'select',
                  options: [
                    { id: 'flex-start', label: 'Start' },
                    { id: 'flex-end', label: 'End' },
                    { id: 'center', label: 'Center' },
                    { id: 'space-between', label: 'Space Between' },
                    { id: 'space-around', label: 'Space Around' },
                    { id: 'space-evenly', label: 'Space Evenly' },
                  ],
                },
                {
                  label: 'Align Items',
                  property: '--align-items',
                  type: 'select',
                  options: [
                    { id: 'stretch', label: 'Stretch' },
                    { id: 'flex-start', label: 'Start' },
                    { id: 'flex-end', label: 'End' },
                    { id: 'center', label: 'Center' },
                    { id: 'baseline', label: 'Baseline' },
                  ],
                },
                { label: 'Gap', property: '--gap', type: 'number', units: ['px', 'rem', 'em', '%'] },
              ],
            },
          ],
        },
      }),
      plugins: definition
        ? [(editor) => this.#componentPlugin(editor, definition)]
        : [],
    });

    const gjsEl = container.querySelector<HTMLElement>('.gjs-editor');
    if (gjsEl) gjsEl.style.height = '100%';
    const gjsCanvas = container.querySelector<HTMLElement>('.gjs-cv-canvas');
    if (gjsCanvas) gjsCanvas.style.cssText = 'top:0;left:0;right:0;bottom:0;width:100%;height:100%;';

    // With no component plugin, the snapshot is the only content source
    if (!definition && this.#hasSnapshot) {
      this.#gjsEditor.onReady(() => this.#applySnapshot());
    }

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

  #resolveLeafDefinitions(definition: ArchuraComponentDefinition): ArchuraComponentDefinition[] {
    if (definition.kind !== 'page') return [definition];
    return (definition.uses ?? [])
      .map((path) => this.#resolveDefinition(path))
      .filter((def): def is ArchuraComponentDefinition => def !== null);
  }

  #componentPlugin(editor: GrapesEditor, definition: ArchuraComponentDefinition): void {
    const isPage = definition.kind === 'page';
    const leafDefinitions = this.#resolveLeafDefinitions(definition);

    for (const def of leafDefinitions) {
      editor.Components.addType(def.tagName, {
        isComponent: (el: Element) => el.tagName?.toLowerCase() === def.tagName,
        model: {
          defaults: {
            tagName: def.tagName,
            draggable: !isPage,
            droppable: false,
            stylable: true,
            ...(isPage && { removable: false, copyable: false }),
          },
        },
      });
    }

    editor.on('load', () => {
      void this.#populateCanvas(editor, definition, leafDefinitions);
    });

    editor.on('component:update', () => this.#notify());
    editor.on('style:change', () => this.#notify());
  }

  async #populateCanvas(
    editor: GrapesEditor,
    definition: ArchuraComponentDefinition,
    leafDefinitions: ArchuraComponentDefinition[]
  ): Promise<void> {
    const canvasDocument = editor.Canvas.getDocument();
    if (!canvasDocument) return;

    try {
      const modules = definition.kind === 'page' ? [...leafDefinitions, definition] : leafDefinitions;
      await Promise.all(modules.map((def) => this.#injectModule(canvasDocument, def.moduleUrl)));

      const traitsByTag = new Map(
        leafDefinitions.map((def) => [def.tagName, this.#registerTraits(editor, canvasDocument, def.tagName)])
      );

      if (this.#hasSnapshot) {
        this.#applySnapshot();
      } else if (definition.kind === 'page') {
        editor.setComponents(await this.#expandPage(canvasDocument, definition.tagName));
        this.#lockStructure(editor);
      } else {
        // Render with default attribute values so GrapesJS picks them up
        const attrs = (traitsByTag.get(definition.tagName) ?? [])
          .filter((t) => t.value !== '')
          .map((t) => `${t.name}="${t.value}"`)
          .join(' ');
        editor.setComponents(`<${definition.tagName}${attrs ? ' ' + attrs : ''}></${definition.tagName}>`);
      }
      this.#notify();
    } catch (error) {
      this.#config.onError?.(error);
    }
  }

  #injectModule(canvasDocument: Document, moduleUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = canvasDocument.createElement('script');
      script.type = 'module';
      script.src = moduleUrl;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load component module "${moduleUrl}"`));
      canvasDocument.head.appendChild(script);
    });
  }

  #registerTraits(
    editor: GrapesEditor,
    canvasDocument: Document,
    tagName: string
  ): Array<{ type: string; name: string; label: string; value: string }> {
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
    return traits;
  }

  async #expandPage(canvasDocument: Document, tagName: string): Promise<string> {
    // The page element is a dev-time authoring construct: serialize only its
    // rendered children, never the element itself — re-parsing a live page
    // element would upgrade it and re-render over GrapesJS-owned DOM
    const host = canvasDocument.createElement('div');
    host.style.display = 'none';
    const pageEl = canvasDocument.createElement(tagName) as HTMLElement & {
      updateComplete?: Promise<unknown>;
    };
    host.appendChild(pageEl);
    canvasDocument.body.appendChild(host);
    await pageEl.updateComplete;
    const markup = pageEl.innerHTML.replace(/<!--[\s\S]*?-->/g, '');
    host.remove();
    return markup;
  }

  #lockStructure(editor: GrapesEditor): void {
    const wrapper = editor.getWrapper();
    if (!wrapper) return;
    wrapper.set({ droppable: false });
    wrapper.onAll((component) => {
      const isArchura = String(component.get('tagName') ?? '').startsWith('archura-');
      component.set({
        draggable: false,
        droppable: false,
        removable: false,
        copyable: false,
        // Layout wrappers from the page template are pure structure: clients
        // interact only with the components on the page
        ...(isArchura ? {} : { selectable: false, hoverable: false, editable: false, layerable: false }),
      });
    });
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

  getTarget(): ArchuraEditTarget | null {
    const definition = this.#definition;
    if (!definition) return null;
    return {
      kind: definition.kind,
      path: [...definition.path],
      label: definition.label ?? definition.path.at(-1) ?? '',
    };
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

  #collectContent(): CanonicalComponentData['content'] {
    const editor = this.#gjsEditor;
    const definition = this.#definition;
    if (!editor || !definition) return {};
    const wrapper = editor.getWrapper();
    if (!wrapper) return {};

    const components = this.#resolveLeafDefinitions(definition).flatMap((def) =>
      wrapper.find(def.tagName).map((instance) => ({
        componentPath: [...def.path],
        tagName: def.tagName,
        instanceId: instance.getId(),
        attributes: instance.getAttributes(),
      }))
    );

    return components.length > 0 ? { components } : {};
  }

  #createCurrentArtifact(): CanonicalComponentData {
    const timestamp = new Date().toISOString();
    const rawHtml = this.#gjsEditor?.getHtml() ?? this.#state.html;
    const rawCss = this.#gjsEditor?.getCss() ?? this.#state.css;
    const { html, css } = transformForDeployment(rawHtml, rawCss);

    return createCanonicalComponentData({
      id: createArtifactId(this.#state.componentPath),
      type: 'component-instance',
      content: this.#collectContent(),
      snapshot: { html, css },
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
