<script lang="ts">
  import { getContext } from 'svelte';
  import { Node, AnnotatedTextProperty } from '$lib/svedit';

  const svedit = getContext('svedit');

  let { path } = $props();
  let node = $derived(svedit.session.get(path));
  let tag = $derived(node.id === 'text_1' ? 'h1' : 'p');
</script>

<Node {path}>
  <AnnotatedTextProperty
    {tag}
    path={[...path, 'content']}
    placeholder="Enter text"
    class={node.id === 'text_1' ? 'title' : 'body'}
  />
</Node>

<style>
  .title {
    margin: 0 0 16px;
    font-size: clamp(2.2rem, 6vw, 3.4rem);
    line-height: 0.95;
  }

  .body {
    max-width: 48ch;
    font-size: 1.1rem;
    line-height: 1.6;
    margin: 0;
  }
</style>
