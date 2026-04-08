<script lang="ts">
  import { Svedit } from '$lib/svedit';
  import { createRichTextSession } from '$lib/svedit-richtext';

  let { doc, label, onChange } = $props();

  let session = $state(createRichTextSession(doc));

  $effect(() => {
    onChange(structuredClone(session.doc));
  });
</script>

<div class="field">
  <span>{label}</span>
  <div class="editor-shell">
    <Svedit {session} path={[session.doc.document_id]} editable={true} />
  </div>
</div>

<style>
  .field {
    display: grid;
    gap: 8px;
  }

  span {
    font-size: 0.875rem;
  }

  .editor-shell {
    border: 1px solid rgba(31, 26, 23, 0.14);
    border-radius: 14px;
    padding: 12px;
    background: white;
  }
</style>
