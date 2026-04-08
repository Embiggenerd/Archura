<script lang="ts">
  import { createBuilderState } from '$lib/svaro/state.svelte';

  let { config, children } = $props();

  createBuilderState(config);
</script>

{@render children()}
