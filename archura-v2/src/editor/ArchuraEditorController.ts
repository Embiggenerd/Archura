import grapesjs, { type Component, type Editor as GrapesEditor, type Trait } from 'grapesjs';
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
  ArchuraPageMeta,
  ArchuraRenderable,
} from './types.js';

type ArchuraTrait = {
  type: string;
  name: string;
  label: string;
  value: string;
  options?: Array<{ id: string; label: string }>;
};

type ArchuraStyleParts = Record<string, string[]>;
type ArchuraResize = { width?: boolean; height?: boolean; min?: number; max?: number };

// Editable media-query breakpoints (desktop-first, max-width). The base
// (Desktop) has no media bucket; these are the narrower override buckets, each
// with a preview width (cosmetic) distinct from its maxWidth (the @media value).
export type ArchuraBreakpoint = { name: string; maxWidth: number; previewWidth: number };

const DEFAULT_BREAKPOINTS: ArchuraBreakpoint[] = [
  { name: 'Tablet', maxWidth: 991, previewWidth: 768 },
  { name: 'Mobile', maxWidth: 767, previewWidth: 375 },
];

const ALL_STYLE_GROUPS = ['typography', 'spacing', 'dimension', 'decorations', 'hover', 'flex'];

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

// Theme rules target elements outside the snapshot fragment (body/:root); they
// must stay in css untouched — inlining onto the parsed doc's body would lose them
const THEME_SELECTOR = /(?:^|,)\s*(?:body|html|:root)(?![\w-])/;

export function transformForDeployment(html: string, css: string): { html: string; css: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(css);
  } catch {
    return { html, css };
  }

  // Read names from cssText: some engines don't enumerate custom props by index
  const customPropNames = (style: CSSStyleDeclaration) =>
    [...style.cssText.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]);

  // A prop overridden inside a media query must not be inlined anywhere:
  // inline styles would beat the media rule at every viewport
  const responsiveProps = new Set<string>();
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSMediaRule)) continue;
    for (const inner of rule.cssRules) {
      if (!(inner instanceof CSSStyleRule)) continue;
      for (const prop of customPropNames(inner.style)) {
        responsiveProps.add(`${inner.selectorText}||${prop}`);
      }
    }
  }

  const keptRules: string[] = [];
  for (const rule of sheet.cssRules) {
    if (!(rule instanceof CSSStyleRule)) {
      keptRules.push(rule.cssText);
      continue;
    }
    if (THEME_SELECTOR.test(rule.selectorText)) {
      keptRules.push(rule.cssText);
      continue;
    }

    const propNames = customPropNames(rule.style).filter(
      (prop) => !responsiveProps.has(`${rule.selectorText}||${prop}`)
    );

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

async function downscaleImage(file: Blob, maxDim: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ?? file), file.type || 'image/png', 0.9)
  );
}

export const GOOGLE_FONTS = [
  'Inter',
  'Poppins',
  'Roboto',
  'Montserrat',
  'Playfair Display',
  'Lora',
  'Merriweather',
  'DM Sans',
];

export const GOOGLE_FONTS_CSS_URL = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map(
  (f) => `family=${f.replaceAll(' ', '+')}:wght@400;700`
).join('&')}&display=swap`;

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
  #dirty = false;
  #stylePartsByTag = new Map<string, ArchuraStyleParts>();
  #activePart: { component: Component; part: string } | null = null;
  #breakpoints: ArchuraBreakpoint[];

  constructor(config: ArchuraEditorConfig = {}) {
    const componentPath = config.initialArtifact?.config.componentPath ?? config.componentPath ?? [];
    this.#components = config.components ?? defaultComponents;
    this.#definition = this.#resolveDefinition(componentPath);
    const html = config.initialArtifact?.snapshot.html ?? createDefaultHtml(componentPath);
    const css = config.initialArtifact?.snapshot.css ?? createDefaultCss();

    this.#config = config;
    this.#hasSnapshot = !!config.initialArtifact;
    this.#breakpoints = this.#readBreakpoints(config.initialArtifact);
    this.#state = {
      componentPath,
      html,
      css,
      ready: false,
      pageMeta: (config.initialArtifact?.content?.page as ArchuraPageMeta | undefined) ?? undefined,
    };
  }

  #readBreakpoints(artifact?: CanonicalComponentData | null): ArchuraBreakpoint[] {
    const stored = artifact?.content?.breakpoints as ArchuraBreakpoint[] | undefined;
    if (!Array.isArray(stored) || stored.length === 0) return DEFAULT_BREAKPOINTS.map((b) => ({ ...b }));
    // Reconcile against defaults so preview widths survive older artifacts
    return DEFAULT_BREAKPOINTS.map((def) => {
      const match = stored.find((s) => s.name === def.name);
      return match ? { ...def, ...match } : { ...def };
    });
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
    this.#dirty = false;
    this.#config.onSave?.({ artifacts: this.#artifacts });
    this.#config.onChange?.(this.#artifacts);
    this.#notify();

    return Promise.resolve(this.#artifacts);
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  #markDirty(): void {
    this.#dirty = true;
  }

  undo(): void {
    this.#gjsEditor?.UndoManager.undo();
  }

  redo(): void {
    this.#gjsEditor?.UndoManager.redo();
  }

  setDevice(name: string): void {
    this.#gjsEditor?.setDevice(name);
    this.#notify();
  }

  getDevice(): string {
    return this.#gjsEditor?.getDevice() || 'Desktop';
  }

  // The active device carries two widths: `width` is the preview (what the
  // frame renders at, adjustable like a browser's responsive viewport) and
  // `widthMedia` is the fixed @media bucket edits are authored into. Adjusting
  // the preview never moves the authoring bucket.
  #activeDevice() {
    return this.#gjsEditor?.Devices.getSelected() ?? null;
  }

  getBreakpoints(): ArchuraBreakpoint[] {
    return this.#breakpoints.map((b) => ({ ...b }));
  }

  // Change a breakpoint's @media threshold. All rules already authored in that
  // bucket rekey to the new value at once (no orphaning), as agreed.
  setBreakpointWidth(name: string, maxWidth: number): void {
    const editor = this.#gjsEditor;
    const bp = this.#breakpoints.find((b) => b.name === name);
    if (!editor || !bp) return;

    const others = this.#breakpoints.filter((b) => b.name !== name).map((b) => b.maxWidth);
    // Keep buckets distinct and within the base; 40px min gap avoids ambiguity
    const clamped = Math.max(240, Math.min(1400, Math.round(maxWidth)));
    if (others.some((w) => Math.abs(w - clamped) < 40)) {
      this.#notify(); // reject: re-render so the input snaps back to the real value
      return;
    }

    const old = bp.maxWidth;
    if (old === clamped) return;
    this.#migrateBucket(editor, old, clamped);
    bp.maxWidth = clamped;

    const device = editor.Devices.get(name);
    device?.set('widthMedia', `${clamped}px`);
    // A same-name setDevice is a no-op, so bounce through the base to force
    // GrapesJS to refresh the authoring media for subsequent edits
    if (editor.getDevice() === name) {
      editor.setDevice('Desktop');
      editor.setDevice(name);
    }
    this.#markDirty();
    this.#notify();
  }

  // Devices are built at init from #breakpoints; when a load replaces
  // #breakpoints (persistence/loadArtifact), push the new thresholds onto the
  // existing device models so the tabs author into the right buckets
  #applyBreakpointsToDevices(): void {
    const editor = this.#gjsEditor;
    if (!editor) return;
    for (const bp of this.#breakpoints) {
      editor.Devices.get(bp.name)?.set('widthMedia', `${bp.maxWidth}px`);
    }
  }

  #migrateBucket(editor: GrapesEditor, oldPx: number, newPx: number): void {
    const oldMedia = `(max-width: ${oldPx}px)`;
    const newParams = `(max-width: ${newPx}px)`;
    const css = editor.Css;
    const moving = css
      .getRules()
      .filter((rule) => String((rule as { get: (k: string) => unknown }).get('mediaText')) === oldMedia);
    // Rekey by re-adding under the new media, then removing the old rule
    for (const rule of moving) {
      const selector = (rule as { getSelectorsString?: () => string }).getSelectorsString?.() ?? '';
      const style = { ...(rule as { getStyle: () => Record<string, string> }).getStyle() };
      if (selector) {
        css.setRule(selector, style, { atRuleType: 'media', atRuleParams: newParams });
      }
      css.remove(rule as never);
    }
  }

  isDeviceWidthAdjustable(): boolean {
    // The base device (no media bucket) is the full-width canvas and is not
    // preview-adjustable; fixed-width devices are
    return !!this.#activeDevice()?.get('widthMedia');
  }

  getDeviceWidth(): number | null {
    const width = this.#activeDevice()?.get('width');
    return width ? parseInt(width, 10) : null;
  }

  setDeviceWidth(px: number): void {
    const editor = this.#gjsEditor;
    const device = this.#activeDevice();
    if (!editor || !device || !device.get('widthMedia')) return;
    const clamped = Math.max(240, Math.min(1600, Math.round(px)));
    device.set('width', `${clamped}px`);
    // Media matching already uses widthMedia (set at setDevice); only the
    // rendered frame width needs to follow, so update the wrapper directly
    const wrapper = this.#canvasContainer?.querySelector<HTMLElement>('.gjs-frame-wrapper');
    if (wrapper) wrapper.style.width = `${clamped}px`;
    editor.Canvas.refresh();
    this.#notify();
  }

  getPageMeta(): ArchuraPageMeta {
    return { ...(this.#state.pageMeta ?? {}) };
  }

  setPageMeta(meta: ArchuraPageMeta): void {
    this.#state = { ...this.#state, pageMeta: { ...this.#state.pageMeta, ...meta } };
    this.#markDirty();
    this.#notify();
  }

  getThemeTokens(): Record<string, string> {
    const style = this.#gjsEditor?.Css.getRule('body')?.getStyle() ?? {};
    return { ...(style as Record<string, string>) };
  }

  setThemeTokens(tokens: Record<string, string>): void {
    const editor = this.#gjsEditor;
    if (!editor) return;
    const current = this.getThemeTokens();
    for (const [key, value] of Object.entries(tokens)) {
      if (value) current[key] = value;
      else delete current[key];
    }
    editor.Css.setRule('body', current);
    this.#markDirty();
    this.#notify();
  }

  getActivePart(): string | null {
    return this.#activePart?.part ?? null;
  }

  clearActivePart(): void {
    const active = this.#activePart;
    this.#activePart = null;
    const editor = this.#gjsEditor;
    if (!editor) return;
    if (active) {
      editor.StyleManager.select(active.component as never);
    }
    this.#setPartHighlight(null);
    this.#notify();
  }

  // Editor-only affordances injected into the canvas document (never into
  // CssComposer, so they cannot leak into artifacts): hover hints on
  // editable/stylable parts, and a dashed outline around the active part
  #injectCanvasHints(editor: GrapesEditor): void {
    const doc = editor.Canvas.getDocument();
    if (!doc || doc.querySelector('style[data-archura-editor-hints]')) return;
    const rules: string[] = [];
    for (const [tag, parts] of this.#stylePartsByTag) {
      for (const part of Object.keys(parts)) {
        if (part === 'host') continue;
        rules.push(
          `${tag}::part(${part}):hover { cursor: text; outline: 1px dashed rgba(99, 102, 241, 0.45); outline-offset: 2px; }`
        );
      }
    }
    const style = doc.createElement('style');
    style.setAttribute('data-archura-editor-hints', '');
    style.textContent = rules.join('\n');
    doc.head.appendChild(style);
  }

  #setPartHighlight(selector: string | null): void {
    const doc = this.#gjsEditor?.Canvas.getDocument();
    if (!doc) return;
    let style = doc.querySelector<HTMLStyleElement>('style[data-archura-part-highlight]');
    if (!style) {
      style = doc.createElement('style');
      style.setAttribute('data-archura-part-highlight', '');
      doc.head.appendChild(style);
    }
    style.textContent = selector
      ? `${selector} { outline: 2px dashed #6366f1 !important; outline-offset: 3px; }`
      : '';
  }

  #propGroupVisible(group: string): boolean {
    if (this.#activePart) return group === 'part';
    if (group === 'part') return false;
    const selected = this.#gjsEditor?.getSelected();
    const styleParts = this.#stylePartsByTag.get(String(selected?.get('tagName') ?? '').toLowerCase());
    return (styleParts?.host ?? ALL_STYLE_GROUPS).includes(group);
  }

  #activatePart(component: Component, part: string): void {
    const editor = this.#gjsEditor;
    if (!editor) return;
    // The ::part rule needs the element id in the exported html
    component.addAttributes({ id: component.getId() });
    this.#activePart = { component, part };
    // Create the rule explicitly: selecting by string loses the ::part()
    // pseudo when the selector round-trips through the selector parser
    const selector = `#${component.getId()}::part(${part})`;
    const rule = editor.Css.getRule(selector) ?? editor.Css.setRule(selector, {});
    editor.StyleManager.select(rule as never);
    this.#setPartHighlight(selector);
    this.#notify();
  }

  #handleCanvasClick(editor: GrapesEditor, event: Event, selectedAtMousedown: Component | null): void {
    // Duck-type: path nodes belong to the iframe realm, so `instanceof
    // Element` against the main window's Element fails
    const path = event.composedPath();
    const partEl = path.find(
      (node): node is Element =>
        typeof (node as Element)?.getAttribute === 'function' && !!(node as Element).getAttribute('part')
    );
    if (!partEl) {
      if (this.#activePart) this.clearActivePart();
      return;
    }
    const part = partEl.getAttribute('part')!;
    const host = (partEl.getRootNode() as ShadowRoot).host;
    const declared = this.#stylePartsByTag.get(host.tagName.toLowerCase());
    if (!declared?.[part]) {
      if (this.#activePart) this.clearActivePart();
      return;
    }
    const component = this.#findComponentForElement(editor, host);
    if (!component) return;
    // Drill-down: only enter the part if this component was already selected
    // when the click began
    if (selectedAtMousedown !== component) return;
    // After GrapesJS finishes its own click/selection handling
    setTimeout(() => this.#activatePart(component, part), 0);
  }

  #findComponentForElement(editor: GrapesEditor, el: Element): Component | null {
    let found: Component | null = null;
    editor.getWrapper()?.onAll((component) => {
      if (component.getEl() === el) found = component;
    });
    return found;
  }

  async uploadAsset(file: Blob, name = 'asset.png'): Promise<string> {
    const upload = this.#config.uploadAsset;
    if (!upload) {
      throw new Error('No uploadAsset handler configured.');
    }
    const scaled = await downscaleImage(file, 1024);
    return upload(scaled, name);
  }

  get canPublish(): boolean {
    return !!this.#config.persistence;
  }

  async publish(): Promise<CanonicalComponentData[]> {
    const persistence = this.#config.persistence;
    if (!persistence) {
      throw new Error('No persistence adapter configured.');
    }

    const artifact = this.#createCurrentArtifact();
    try {
      await persistence.publish(artifact);
    } catch (error) {
      this.#config.onError?.(error);
      throw error;
    }

    this.#artifacts = [artifact];
    this.#dirty = false;
    this.#config.onSave?.({ artifacts: this.#artifacts });
    this.#config.onChange?.(this.#artifacts);
    this.#notify();
    return [...this.#artifacts];
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
      pageMeta: (artifact.content?.page as ArchuraPageMeta | undefined) ?? undefined,
    };
    this.#hasSnapshot = true;
    this.#definition = this.#resolveDefinition(this.#state.componentPath);
    this.#breakpoints = this.#readBreakpoints(artifact);
    this.#applyBreakpointsToDevices();
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
      // Canvas-only (not exported): keeps full-width components off the
      // clipped canvas edge so resize handles stay reachable
      canvasCss: 'body { padding: 12px; }',
      panels: { defaults: [] },
      deviceManager: {
        devices: [
          { id: 'Desktop', name: 'Desktop', width: '' },
          ...this.#breakpoints.map((b) => ({
            id: b.name,
            name: b.name,
            width: `${b.previewWidth}px`,
            widthMedia: `${b.maxWidth}px`,
          })),
        ],
      },
      canvas: { styles: [GOOGLE_FONTS_CSS_URL] },
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
                    ...GOOGLE_FONTS.map((f) => ({ id: `'${f}', sans-serif`, label: f })),
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
              // Shown only while a shadow part is active; writes real CSS
              // properties into a `#id::part(name)` rule (outer ::part
              // declarations beat shadow-tree defaults in the cascade)
              name: 'Selected Part',
              open: true,
              visible: false,
              properties: [
                { label: 'Color', property: 'color', type: 'color' },
                { label: 'Font Size', property: 'font-size', type: 'number', units: ['px', 'rem', 'em'] },
                {
                  label: 'Font Weight',
                  property: 'font-weight',
                  type: 'select',
                  options: [
                    { id: '300', label: 'Light' },
                    { id: '400', label: 'Normal' },
                    { id: '600', label: 'Semibold' },
                    { id: '700', label: 'Bold' },
                  ],
                },
                {
                  label: 'Font Family',
                  property: 'font-family',
                  type: 'select',
                  options: [
                    { id: 'inherit', label: 'Inherit' },
                    ...GOOGLE_FONTS.map((f) => ({ id: `'${f}', sans-serif`, label: f })),
                  ],
                },
                { label: 'Line Height', property: 'line-height', type: 'number', units: ['', 'px'] },
                { label: 'Letter Spacing', property: 'letter-spacing', type: 'number', units: ['px', 'em'] },
                {
                  label: 'Text Align',
                  property: 'text-align',
                  type: 'select',
                  options: [
                    { id: 'left', label: 'Left' },
                    { id: 'center', label: 'Center' },
                    { id: 'right', label: 'Right' },
                  ],
                },
                {
                  label: 'Font Style',
                  property: 'font-style',
                  type: 'select',
                  options: [
                    { id: 'normal', label: 'Normal' },
                    { id: 'italic', label: 'Italic' },
                  ],
                },
                {
                  label: 'Text Decoration',
                  property: 'text-decoration',
                  type: 'select',
                  options: [
                    { id: 'none', label: 'None' },
                    { id: 'underline', label: 'Underline' },
                    { id: 'line-through', label: 'Line Through' },
                  ],
                },
              ],
            },
            {
              name: 'Hover',
              properties: [
                { label: 'Background', property: '--hover-background-color', type: 'color' },
                { label: 'Text Color', property: '--hover-color', type: 'color' },
                { label: 'Box Shadow', property: '--hover-box-shadow', type: 'base' },
                { label: 'Transform', property: '--hover-transform', type: 'base' },
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

    // Property visibility is a pure function of our scoping state; GrapesJS
    // re-derives sector visibility from it on every refresh, so this stays
    // correct without fighting the StyleManager's own passes
    const sectors = this.#gjsEditor.StyleManager.getSectors() as unknown as {
      forEach: (fn: (s: { get: (k: string) => unknown; getProperties: () => Array<{ set: (k: string, v: unknown) => void }> }) => void) => void;
    };
    sectors.forEach((sector) => {
      const name = String(sector.get('name')).toLowerCase();
      const group = name === 'selected part' ? 'part' : name;
      sector.getProperties().forEach((prop) => {
        prop.set('isVisible', () => this.#propGroupVisible(group));
      });
    });

    this.#registerAssetTrait(this.#gjsEditor);
    this.#setupColorPickerFix();
  }

  #registerAssetTrait(editor: GrapesEditor): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const controller = this;
    type TraitArgs = { component: Component; trait: Trait; elInput: HTMLInputElement };
    editor.TraitManager.addType('asset', {
      createInput({ trait }: TraitArgs) {
        const el = document.createElement('div');
        el.dataset.traitName = String(trait.get('name') ?? '');
        el.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        el.innerHTML = `
          <img data-preview style="display:none;max-width:100%;max-height:64px;object-fit:contain;border:1px solid #ddd;border-radius:4px;background:#fff;" />
          <div style="display:flex;gap:6px;">
            <button type="button" data-upload style="flex:1;">Upload image</button>
            <button type="button" data-clear style="display:none;">✕</button>
          </div>
          <input data-file type="file" accept="image/png,image/jpeg,image/webp"
                 style="position:absolute;width:1px;height:1px;opacity:0;" />`;
        const fileInput = el.querySelector<HTMLInputElement>('[data-file]')!;
        el.querySelector('[data-upload]')!.addEventListener('click', (e) => {
          e.preventDefault();
          fileInput.click();
        });
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files?.[0];
          fileInput.value = '';
          if (!file) return;
          try {
            el.dataset.value = await controller.uploadAsset(file, file.name);
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (error) {
            controller.#config.onError?.(error);
          }
        });
        el.querySelector('[data-clear]')!.addEventListener('click', (e) => {
          e.preventDefault();
          el.dataset.value = '';
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return el;
      },
      onEvent({ elInput, component }: TraitArgs) {
        const name = elInput.dataset.traitName;
        if (name) component.addAttributes({ [name]: elInput.dataset.value ?? '' });
      },
      onUpdate({ elInput, component }: TraitArgs) {
        const name = elInput.dataset.traitName;
        const value = name ? String(component.getAttributes()[name] ?? '') : '';
        const preview = elInput.querySelector<HTMLImageElement>('[data-preview]')!;
        const clear = elInput.querySelector<HTMLElement>('[data-clear]')!;
        preview.style.display = value ? 'block' : 'none';
        if (value) preview.src = value;
        clear.style.display = value ? 'block' : 'none';
        elInput.dataset.value = value;
      },
    });
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

    editor.on('component:update', () => {
      this.#markDirty();
      this.#notify();
    });
    editor.on('style:change', () => {
      this.#markDirty();
      this.#notify();
    });
    editor.on('component:selected', () => {
      this.#activePart = null;
      this.#notify();
    });
    editor.on('component:deselected', () => {
      if (this.#activePart) this.clearActivePart();
    });
    // Seed enabled resize axes so GrapesJS's unit detection reads the value
    // from the model instead of bracket-accessing computed style (which
    // returns undefined for custom props and throws upstream)
    editor.on('component:resize:init', (opts: { component?: Component }) => {
      const component = opts.component;
      const el = component?.getEl();
      const resizableConfig = component?.get('resizable') as { cr?: boolean; bc?: boolean } | boolean | undefined;
      if (!component || !el || typeof resizableConfig !== 'object') return;
      const style = component.getStyle() as Record<string, string>;
      const seeds: Record<string, string> = {};
      if (resizableConfig.cr && !style['--width']) seeds['--width'] = '100%';
      if (resizableConfig.bc && !style['--min-height']) seeds['--min-height'] = `${el.offsetHeight}px`;
      if (Object.keys(seeds).length > 0) component.addStyle(seeds, { avoidStore: true });
    });
  }

  async #populateCanvas(
    editor: GrapesEditor,
    definition: ArchuraComponentDefinition,
    leafDefinitions: ArchuraComponentDefinition[]
  ): Promise<void> {
    const canvasDocument = editor.Canvas.getDocument();
    if (!canvasDocument) return;

    // Boot from the host's stored artifact when one exists; a failed load
    // reports through onError and falls back to template defaults
    if (!this.#hasSnapshot && this.#config.persistence) {
      try {
        const target = this.getTarget();
        const artifact = target ? await this.#config.persistence.load(target) : null;
        if (artifact) {
          this.#state = {
            componentPath: [...artifact.config.componentPath],
            html: artifact.snapshot.html,
            css: artifact.snapshot.css,
            ready: this.#state.ready,
            pageMeta: (artifact.content?.page as ArchuraPageMeta | undefined) ?? undefined,
          };
          this.#hasSnapshot = true;
          this.#breakpoints = this.#readBreakpoints(artifact);
          this.#applyBreakpointsToDevices();
          this.#artifacts = [artifact];
        }
      } catch (error) {
        this.#config.onError?.(error);
      }
    }

    try {
      const modules = definition.kind === 'page' ? [...leafDefinitions, definition] : leafDefinitions;
      await Promise.all(modules.map((def) => this.#injectModule(canvasDocument, def.moduleUrl)));

      const traitsByTag = new Map(
        leafDefinitions.map((def) => [def.tagName, this.#registerTraits(editor, canvasDocument, def.tagName)])
      );

      // Part selection is a drill-down: first click selects the component,
      // clicking again while selected enters the part under the cursor
      let selectedAtMousedown: Component | null = null;
      canvasDocument.addEventListener(
        'mousedown',
        () => {
          selectedAtMousedown = (editor.getSelected() as Component | undefined) ?? null;
        },
        true
      );
      // Capture phase: GrapesJS stops propagation of component clicks
      canvasDocument.addEventListener(
        'click',
        (event) => this.#handleCanvasClick(editor, event, selectedAtMousedown),
        true
      );
      canvasDocument.addEventListener('archura:text-edit', (event) => {
        const { trait, value } = (event as CustomEvent<{ trait: string; value: string }>).detail;
        const host = event.target as Element;
        const component = this.#findComponentForElement(editor, host);
        component?.addAttributes({ [trait]: value });
      });

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
      this.#injectCanvasHints(editor);
      // Loading/expansion fires component:update; the canvas isn't user-dirty yet
      this.#dirty = false;
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

  #registerTraits(editor: GrapesEditor, canvasDocument: Document, tagName: string): ArchuraTrait[] {
    const iframeWindow = canvasDocument.defaultView as (Window & { customElements: CustomElementRegistry }) | null;
    type LitPropConfig = { type?: unknown; asset?: boolean; options?: string[] };
    type LitCtor = CustomElementConstructor & {
      properties?: Record<string, LitPropConfig>;
      styleParts?: ArchuraStyleParts;
      resize?: ArchuraResize;
    };
    const ctor = iframeWindow?.customElements.get(tagName) as LitCtor | undefined;

    if (ctor?.styleParts) this.#stylePartsByTag.set(tagName, ctor.styleParts);

    // Use own static properties only (not inherited) to avoid showing base-class internals
    const ownProps = ctor?.properties ? Object.entries(ctor.properties) : [];

    // Create a detached instance to read constructor default values
    const tempEl = canvasDocument.createElement(tagName) as HTMLElement & Record<string, unknown>;

    const traits: ArchuraTrait[] = ownProps
      .filter(([, cfg]) => {
        // Use .name comparison to avoid cross-realm (iframe vs main window) === failure
        const n = (cfg.type as { name?: string } | undefined)?.name;
        return !cfg.type || n === 'String' || n === 'Number' || n === 'Boolean';
      })
      .map(([name, cfg]) => {
        const n = (cfg.type as { name?: string } | undefined)?.name;
        const defaultVal = tempEl[name];
        const base = {
          name,
          label: name.charAt(0).toUpperCase() + name.slice(1),
          value: defaultVal !== undefined ? String(defaultVal) : '',
        };
        if (cfg.asset) return { ...base, type: 'asset' };
        if (cfg.options) {
          return { ...base, type: 'select', options: cfg.options.map((o) => ({ id: o, label: o })) };
        }
        return { ...base, type: n === 'Number' ? 'number' : n === 'Boolean' ? 'checkbox' : 'text' };
      });

    // Drag-to-resize: components opt in per axis; the Resizer writes the
    // same knobs the style panel edits (--width/--height), device-aware
    const resize = ctor?.resize;
    const bothAxes = !!(resize?.width && resize?.height);
    const resizable = resize
      ? {
          cl: !!resize.width,
          cr: !!resize.width,
          tc: !!resize.height,
          bc: !!resize.height,
          tl: bothAxes, tr: bothAxes, bl: bothAxes, br: bothAxes,
          // Disabled axes keep the real CSS property: GrapesJS's unit lookup
          // bracket-accesses computed style, which fails for custom props.
          // Height writes --min-height so a taller drag sticks but content
          // can never be clipped by a fixed height.
          keyWidth: resize.width ? '--width' : 'width',
          keyHeight: resize.height ? '--min-height' : 'height',
          ...(resize.min && { minDim: resize.min }),
          ...(resize.max && { maxDim: resize.max }),
          // GrapesJS binds the resizer's pointer listeners on `document`, but
          // our handles live inside the shell's shadow root — events reaching
          // the document are retargeted to the host and never match a handler.
          // Listen inside the shadow root instead.
          docs: [this.#resizerListenerRoot()],
        }
      : undefined;

    if (traits.length > 0 || resizable) {
      editor.Components.addType(tagName, {
        model: { defaults: { ...(traits.length > 0 && { traits }), ...(resizable && { resizable }) } },
      });
    }
    return traits;
  }

  #resizerListenerRoot(): Document | ShadowRoot {
    const root = this.#canvasContainer?.getRootNode();
    if (root instanceof ShadowRoot) {
      // GrapesJS's toggleBodyClass expects `doc.body`; point it at the host
      const shadow = root as ShadowRoot & { body?: Element };
      if (!shadow.body) shadow.body = root.host;
      return root;
    }
    return document;
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
    this.#canvasContainer = null;
    this.#stylePanelContainer = null;
    this.#traitsPanelContainer = null;
    this.#initScheduled = false;
    this.#renderables.clear();
  }

  registerRenderable(renderable: ArchuraRenderable): void {
    this.#renderables.add(renderable);
  }

  unregisterRenderable(renderable: ArchuraRenderable): void {
    this.#renderables.delete(renderable);
  }

  getComponents(): ArchuraComponentDefinition[] {
    return [...this.#components];
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

  // Durable instance identity: content.components entries must keep their
  // instanceIds across publish → reload → publish, so ids are stamped as
  // attributes before the html snapshot is taken
  #ensureInstanceIds(): void {
    const editor = this.#gjsEditor;
    const definition = this.#definition;
    if (!editor || !definition) return;
    const wrapper = editor.getWrapper();
    if (!wrapper) return;
    for (const def of this.#resolveLeafDefinitions(definition)) {
      for (const instance of wrapper.find(def.tagName)) {
        if (!instance.getAttributes().id) {
          instance.addAttributes({ id: instance.getId() });
        }
      }
    }
  }

  #createCurrentArtifact(): CanonicalComponentData {
    this.#ensureInstanceIds();
    const timestamp = new Date().toISOString();
    const rawHtml = this.#gjsEditor?.getHtml() ?? this.#state.html;
    const rawCss = this.#gjsEditor?.getCss() ?? this.#state.css;
    const { html, css } = transformForDeployment(rawHtml, rawCss);

    const content = this.#collectContent();
    const pageMeta = this.#state.pageMeta;
    if (pageMeta && (pageMeta.title || pageMeta.description)) {
      content.page = { ...pageMeta };
    }
    // Persist breakpoints only when customized, so the CSS media values and the
    // stored thresholds can never drift out of sync on reload
    if (this.#breakpoints.some((b, i) => b.maxWidth !== DEFAULT_BREAKPOINTS[i]?.maxWidth)) {
      content.breakpoints = this.#breakpoints.map((b) => ({ ...b }));
    }

    return createCanonicalComponentData({
      id: createArtifactId(this.#state.componentPath),
      type: 'component-instance',
      content,
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
