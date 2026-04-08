<script lang="ts">
  import { onMount } from 'svelte';
  import sampleProject from '../../../project-data/hero-page.sample.json';
  import { initEditor } from '$lib/editor/init-editor';

  let editorHost: HTMLDivElement;
  let editorReady = false;
  let status = 'Loading GrapesJS runtime...';
  let projectPreview = JSON.stringify(sampleProject, null, 2);
  let heroPreview = JSON.stringify(extractHeroSummary(sampleProject), null, 2);
  let cssPreview = '';
  let runtimePreview = 'No runtime diagnostics yet.';
  let selectedPart: 'headline' | 'primary-action' = 'headline';
  let partControls = {
    headline: {
      color: '#f6e7d8',
      fontSize: 'clamp(3rem, 8vw, 6.5rem)',
      letterSpacing: '-0.08em',
      textTransform: 'none'
    },
    'primary-action': {
      background: '#ffd8ba',
      color: '#4a2415',
      borderRadius: '999px',
      paddingInline: '1.35rem'
    }
  };
  let activeEditor:
    | {
        destroy?: () => void;
        on?: (name: string, cb: () => void) => void;
        getProjectData?: () => unknown;
        getCss?: () => string;
        Css?: { setRule?: (selector: string, style: Record<string, string>) => void };
      }
    | null = null;

  function extractHeroSummary(projectData: any) {
    const firstPage = projectData?.pages?.[0];
    const firstComponent = firstPage?.component?.components?.[0];

    return {
      type: firstComponent?.type ?? null,
      tagName: firstComponent?.tagName ?? null,
      attributes: firstComponent?.attributes ?? {},
      style: firstComponent?.style ?? {},
      parts: ['section', 'eyebrow', 'headline', 'subheadline', 'actions', 'primary-action', 'secondary-action']
    };
  }

  function syncInspector(editor: NonNullable<typeof activeEditor>) {
    const nextProjectData = editor.getProjectData?.();
    projectPreview = JSON.stringify(nextProjectData, null, 2);
    heroPreview = JSON.stringify(extractHeroSummary(nextProjectData), null, 2);
    cssPreview = editor.getCss?.() ?? '';
    runtimePreview = JSON.stringify(readRuntimeHeroDiagnostics(editor), null, 2);
  }

  function readRuntimeHeroDiagnostics(editor: NonNullable<typeof activeEditor>) {
    const canvasDocument =
      (editor as any).Canvas?.getDocument?.() ??
      (editor as any).Canvas?.getFrameEl?.()?.contentDocument ??
      null;
    if (!canvasDocument) {
      return { status: 'Canvas document unavailable' };
    }

    const tagName = 'builder-hero-lit';
    const hero = canvasDocument.querySelector(tagName) as HTMLElement | null;

    if (!hero) {
      return {
        status: 'Hero element not found in canvas',
        tagName
      };
    }

    const computed = canvasDocument.defaultView?.getComputedStyle(hero);
    const shadowRoot = (hero as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    const shadowStyleText = shadowRoot
      ? Array.from(shadowRoot.querySelectorAll('style'))
          .map((node) => node.textContent ?? '')
          .join('\n')
      : '';

    return {
      status: 'ok',
      tagName,
      attributes: Object.fromEntries(Array.from(hero.attributes).map((attr) => [attr.name, attr.value])),
      inlineStyle: hero.getAttribute('style'),
      shadowRoot: !!shadowRoot,
      shadowStyleTagCount: shadowRoot?.querySelectorAll('style').length ?? 0,
      shadowStyleLength: shadowStyleText.length,
      shadowHtmlPreview: shadowRoot?.innerHTML?.slice(0, 500) ?? null,
      computed: {
        display: computed?.display,
        minHeight: computed?.minHeight,
        paddingTop: computed?.paddingTop,
        paddingBottom: computed?.paddingBottom,
        backgroundColor: computed?.backgroundColor,
        color: computed?.color,
        heroSurface: computed?.getPropertyValue('--hero-surface')?.trim(),
        heroAccent: computed?.getPropertyValue('--hero-accent')?.trim(),
        heroSpaceY: computed?.getPropertyValue('--hero-space-y')?.trim()
      }
    };
  }

  function applyPartStyle(part: 'headline' | 'primary-action') {
    if (!activeEditor?.Css?.setRule) return;

    const selector = `builder-hero-lit::part(${part})`;

    const style =
      part === 'headline'
        ? {
            color: partControls.headline.color,
            'font-size': partControls.headline.fontSize,
            'letter-spacing': partControls.headline.letterSpacing,
            'text-transform': partControls.headline.textTransform
          }
        : {
            background: partControls['primary-action'].background,
            color: partControls['primary-action'].color,
            'border-radius': partControls['primary-action'].borderRadius,
            'padding-inline': partControls['primary-action'].paddingInline
          };

    activeEditor.Css.setRule(selector, style);
    syncInspector(activeEditor);
  }

  async function bootEditor() {
    if (!editorHost) return;

    activeEditor?.destroy?.();
    editorHost.innerHTML = '';
    editorReady = false;

    try {
      const editor = await initEditor(editorHost);
      activeEditor = editor;
      editorReady = true;
      status = 'Lit Hero registered. Edit traits and inspect project data.';
      syncInspector(editor);

      editor.on('load', () => {
        syncInspector(editor);
      });

      editor.on('update', () => {
        syncInspector(editor);
      });
    } catch (error) {
      status = error instanceof Error ? error.message : 'Failed to start GrapesJS.';
    }
  }

  onMount(() => {
    bootEditor();
  });
</script>

<svelte:head>
  <title>GrapesJS Web Builder Example</title>
</svelte:head>

<div class="layout">
  <section class="editor-shell">
    <div class="toolbar">
      <h1>GrapesJS + Web Components</h1>
      <p>{status}</p>
    </div>
    <div bind:this={editorHost} class:ready={editorReady} class="editor-host"></div>
  </section>

  <aside class="sidebar">
    <h2>`::part(...)` Editor</h2>
    <p>
      These controls write real persisted CSS rules targeting the Hero’s exposed parts. This is styling only, not
      content.
    </p>
    <div class="part-editor">
      <label>
        <span>Part</span>
        <select bind:value={selectedPart}>
          <option value="headline">headline</option>
          <option value="primary-action">primary-action</option>
        </select>
      </label>

      {#if selectedPart === 'headline'}
        <label>
          <span>Color</span>
          <input bind:value={partControls.headline.color} type="color" />
        </label>
        <label>
          <span>Font Size</span>
          <input bind:value={partControls.headline.fontSize} type="text" />
        </label>
        <label>
          <span>Letter Spacing</span>
          <input bind:value={partControls.headline.letterSpacing} type="text" />
        </label>
        <label>
          <span>Text Transform</span>
          <select bind:value={partControls.headline.textTransform}>
            <option value="none">none</option>
            <option value="uppercase">uppercase</option>
            <option value="capitalize">capitalize</option>
          </select>
        </label>
      {:else}
        <label>
          <span>Background</span>
          <input bind:value={partControls['primary-action'].background} type="color" />
        </label>
        <label>
          <span>Color</span>
          <input bind:value={partControls['primary-action'].color} type="color" />
        </label>
        <label>
          <span>Border Radius</span>
          <input bind:value={partControls['primary-action'].borderRadius} type="text" />
        </label>
        <label>
          <span>Padding Inline</span>
          <input bind:value={partControls['primary-action'].paddingInline} type="text" />
        </label>
      {/if}

      <button class="apply-button" type="button" on:click={() => applyPartStyle(selectedPart)}>Apply Part Styles</button>
    </div>

    <h2>Hero Summary</h2>
    <p>
      This compact view should show the actual persisted values GrapesJS is editing on the selected Hero instance,
      including the host CSS variables.
    </p>
    <pre>{heroPreview}</pre>

    <h2>Generated CSS</h2>
    <p>This should include rules like `builder-hero-lit::part(headline)` or `builder-hero-svelte::part(headline)`.</p>
    <pre>{cssPreview || 'No CSS rules yet.'}</pre>

    <h2>Runtime Diagnostics</h2>
    <p>
      This inspects the actual rendered custom element inside the GrapesJS iframe so we can compare Lit and Svelte
      runtime behavior.
    </p>
    <pre>{runtimePreview}</pre>

    <h2>Saved Project Data</h2>
    <p>
      This should reflect the real edited Hero instance, including attributes like `headline`, `theme`, `surface`, and
      `space-y`.
    </p>
    <pre>{projectPreview}</pre>
  </aside>
</div>

<style>
  :global(body) {
    margin: 0;
    background: #efe9df;
    color: #1d1a17;
    font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(22rem, 0.8fr);
    min-height: 100vh;
  }

  .editor-shell {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 100vh;
    border-right: 1px solid rgba(29, 26, 23, 0.12);
    background: #f8f3ea;
  }

  .toolbar {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid rgba(29, 26, 23, 0.12);
    background: #fffaf2;
  }

  .toolbar h1 {
    margin: 0;
    font-size: 1.1rem;
  }

  .toolbar p {
    margin: 0.4rem 0 0;
    color: #665f57;
    font-size: 0.92rem;
  }

  .editor-host {
    min-height: 0;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .editor-host.ready {
    opacity: 1;
  }

  .sidebar {
    padding: 1.25rem;
    background: #181511;
    color: #f7efe4;
  }

  .sidebar h2 {
    margin-top: 0;
    font-size: 1rem;
  }

  .sidebar h2 + p {
    margin-top: 0.5rem;
  }

  .sidebar p {
    color: #d4c8b7;
    line-height: 1.5;
  }

  .part-editor {
    display: grid;
    gap: 0.75rem;
    margin: 0.85rem 0 1.25rem;
  }

  .part-editor label {
    display: grid;
    gap: 0.35rem;
  }

  .part-editor span {
    color: #d4c8b7;
    font-size: 0.82rem;
  }

  .part-editor input,
  .part-editor select {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.06);
    color: #fff3e5;
    padding: 0.7rem 0.8rem;
    font: inherit;
  }

  .part-editor input[type='color'] {
    min-height: 2.8rem;
    padding: 0.35rem;
  }

  .apply-button {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0.9rem;
    background: rgba(255, 255, 255, 0.06);
    color: #fff3e5;
    padding: 0.8rem 0.9rem;
    font: inherit;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .apply-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .sidebar pre {
    overflow: auto;
    padding: 1rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.06);
    font-size: 0.82rem;
    line-height: 1.45;
    margin-bottom: 1.25rem;
  }

  @media (max-width: 980px) {
    .layout {
      grid-template-columns: 1fr;
    }

    .editor-shell {
      min-height: 65vh;
    }
  }
</style>
