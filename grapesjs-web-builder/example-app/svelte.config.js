import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  compilerOptions: {
    customElement: ({ filename }) => filename?.endsWith('.ce.svelte') ?? false
  },
  kit: {
    adapter: adapter()
  }
};

export default config;
