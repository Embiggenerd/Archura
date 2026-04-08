<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import { initEditor } from '$lib/editor/init-editor';

  let editorHost: HTMLDivElement;
  let activeEditor: { destroy?: () => void } | null = null;
  let editorReady = false;
  let errorMessage = '';

  async function bootEditor() {
    if (!editorHost) return;

    activeEditor?.destroy?.();
    editorHost.innerHTML = '';
    editorReady = false;
    errorMessage = '';

    try {
      const componentPath = get(page).params.componentPath.split('/');
      console.log('[demo route] bootEditor start', { componentPath });
      activeEditor = await initEditor(editorHost, componentPath);
      editorReady = true;
      console.log('[demo route] editor host diagnostics', {
        childElementCount: editorHost.childElementCount,
        className: editorHost.className,
        innerHtmlPreview: editorHost.innerHTML.slice(0, 1000),
      });
      console.log('[demo route] editor ready', { componentPath });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load component editor.';
      console.error('[demo route] editor boot failed', error);
    }
  }

  onMount(() => {
    bootEditor();
  });
</script>

<svelte:head>
  <title>GrapesJS Component Editor</title>
</svelte:head>

<div class="page">
  <div class="topbar">
    <div class="left">
      <strong>GrapesJS Component Editor</strong>
      <span>{get(page).params.componentPath}</span>
    </div>

    <div class="right">
      <a href="/demo">Default Demo</a>
    </div>
  </div>

  {#if errorMessage}
    <div class="error">{errorMessage}</div>
  {/if}

  <div bind:this={editorHost} class:ready={editorReady} class="editor-host"></div>
</div>

<style>
  :global(body) {
    margin: 0;
    background: #efefef;
    color: #1d1a17;
    font-family: Helvetica, Arial, sans-serif;
  }

  .page {
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 100vh;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.8rem 1rem;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    background: #fafafa;
  }

  .left {
    display: grid;
    gap: 0.2rem;
  }

  .left span {
    color: #666;
    font-size: 0.88rem;
  }

  .right a {
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 999px;
    background: white;
    color: #222;
    padding: 0.45rem 0.9rem;
    font: inherit;
    font-size: 0.9rem;
    text-decoration: none;
    cursor: pointer;
  }

  .error {
    grid-column: 1;
    padding: 0.85rem 1rem;
    background: #fff1f2;
    color: #9f1239;
    border-bottom: 1px solid #fecdd3;
  }

  .editor-host {
    grid-column: 1;
    grid-row: 2;
    height: 100%;
    min-height: calc(100vh - 57px);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .editor-host.ready {
    opacity: 1;
  }
</style>
