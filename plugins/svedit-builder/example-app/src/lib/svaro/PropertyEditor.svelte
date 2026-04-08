<script lang="ts">
  import { getBuilderState } from '$lib/svaro/state.svelte';
  import RichTextFieldEditor from '$lib/svaro/RichTextFieldEditor.svelte';

  const builder = getBuilderState();

  function handleInput(instanceId, key, event) {
    builder.updateProp(instanceId, key, event.currentTarget.value);
  }
</script>

<aside class="panel">
  <h2>Properties</h2>

  {#if !builder.selectedInstance}
    <p>Select a component to edit it.</p>
  {:else}
    {@const instance = builder.selectedInstance}
    {@const definition = builder.config.find((item) => item.id === instance.type)}

    <div class="fields">
      {#each Object.entries(definition?.fields ?? {}) as [key, field]}
        {#if field.type === 'text' || field.type === 'color'}
          <label>
            <span>{field.label}</span>
            <input
              type={field.type === 'color' ? 'color' : 'text'}
              value={instance.props[key] ?? ''}
              on:input={(event) => handleInput(instance.id, key, event)}
            />
          </label>
        {:else if field.type === 'rich_text'}
          <RichTextFieldEditor
            label={field.label}
            doc={instance.richText[key]}
            onChange={(doc) => builder.updateRichText(instance.id, key, doc)}
          />
        {/if}
      {/each}
    </div>

    <button class="remove" type="button" on:click={() => builder.removeSelected()}>
      Delete component
    </button>
  {/if}
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

  .fields {
    display: grid;
    gap: 12px;
  }

  label {
    display: grid;
    gap: 8px;
  }

  span {
    font-size: 0.875rem;
  }

  input {
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid rgba(31, 26, 23, 0.14);
    font: inherit;
  }

  .remove {
    border-radius: 14px;
    padding: 10px 14px;
    border: 1px solid #b12828;
    color: #b12828;
    background: white;
    cursor: pointer;
    font: inherit;
  }
</style>
