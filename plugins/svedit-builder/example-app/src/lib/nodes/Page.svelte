<script lang="ts">
  import { Node, NodeArrayProperty } from '$lib/svedit';

  let { path } = $props();
</script>

<Node {path}>
  <section class="card">
    <p class="eyebrow">Simple Svedit Example</p>
    <NodeArrayProperty path={[...path, 'body']} />
  </section>
</Node>

<style>
  .card {
    width: min(100%, 560px);
    background: rgba(255, 255, 255, 0.78);
    border: 1px solid rgba(31, 26, 23, 0.12);
    border-radius: 28px;
    padding: 28px;
    box-shadow: 0 20px 60px rgba(31, 26, 23, 0.1);
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 12px;
    margin: 0 0 12px;
  }
</style>
