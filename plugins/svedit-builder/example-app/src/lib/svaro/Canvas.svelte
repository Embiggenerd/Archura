<script lang="ts">
  import { getBuilderState } from '$lib/svaro/state.svelte';

  const builder = getBuilderState();
</script>

<main class="canvas">
  {#if builder.instances.length === 0}
    <div class="empty">
      Add a component from the left to start building the page.
    </div>
  {:else}
    {#each builder.instances as instance}
      {@const Component = builder.config.find((definition) => definition.id === instance.type)?.render}
      <button
        type="button"
        class:selected={builder.selectedId === instance.id}
        class="component-shell"
        on:click={() => builder.select(instance.id)}
      >
        <div class="component-label">{instance.type}</div>
        {#if Component}
          <div class="component-view">
            <Component {...builder.getRenderProps(instance)} />
          </div>
        {/if}
      </button>
    {/each}
  {/if}
</main>

<style>
  .canvas {
    min-height: 70vh;
    border: 1px dashed rgba(31, 26, 23, 0.2);
    border-radius: 24px;
    padding: 18px;
    background: rgba(255, 255, 255, 0.5);
    display: grid;
    gap: 16px;
    align-content: start;
  }

  .empty {
    border-radius: 18px;
    padding: 32px;
    background: rgba(31, 26, 23, 0.05);
    text-align: center;
  }

  .component-shell {
    border: 1px solid rgba(31, 26, 23, 0.12);
    border-radius: 20px;
    background: white;
    padding: 12px;
    text-align: left;
    cursor: pointer;
  }

  .component-shell.selected {
    outline: 2px solid #cb5b2c;
  }

  .component-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.6;
    margin-bottom: 8px;
  }
</style>
