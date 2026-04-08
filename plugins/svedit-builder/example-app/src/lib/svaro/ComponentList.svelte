<script lang="ts">
  import { getBuilderState } from '$lib/svaro/state.svelte';

  const builder = getBuilderState();
</script>

<aside class="panel">
  <h2>Components</h2>
  <div class="list">
    {#each builder.config as component}
      <button type="button" on:click={() => builder.add(component.id)}>
        Add {component.name}
      </button>
    {/each}
  </div>
</aside>

<style>
  .panel {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  h2 {
    margin: 0;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .list {
    display: grid;
    gap: 10px;
  }

  button {
    border: 1px solid rgba(31, 26, 23, 0.14);
    border-radius: 14px;
    padding: 12px 14px;
    background: white;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }
</style>
