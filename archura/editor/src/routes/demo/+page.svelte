<script lang="ts">
  import { onMount } from 'svelte';
  import { initEditor } from '$lib/editor/init-editor';

  let editorHost: HTMLDivElement;
  let activeEditor: { destroy?: () => void } | null = null;
  let editorReady = false;

  async function bootEditor() {
    if (!editorHost) return;

    activeEditor?.destroy?.();
    editorHost.innerHTML = '';
    editorReady = false;
    activeEditor = await initEditor(editorHost);
    editorReady = true;
  }

  onMount(() => {
    bootEditor();
  });
</script>

<svelte:head>
  <title>GrapesJS Demo Comparison</title>
</svelte:head>

<div class="page">
  <div class="topbar">
    <div class="left">
      <strong>GrapesJS Demo</strong>
      <span>Minimal shell, mostly default editor UI, Lit-first component rendering</span>
    </div>

    <div class="right">
      <a href="/">Instrumented View</a>
    </div>
  </div>

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

  .right {
    display: flex;
    align-items: center;
    gap: 0.55rem;
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

  .editor-host {
    min-height: 0;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .editor-host.ready {
    opacity: 1;
  }

  @media (max-width: 720px) {
    .topbar {
      flex-direction: column;
      align-items: stretch;
    }

    .right {
      flex-wrap: wrap;
    }
  }
</style>
