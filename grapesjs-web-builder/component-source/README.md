# Component Source

Each approved component should be authored in both implementations:

- `svelte/`
- `lit/`

Why:

- compare authoring experience
- compare custom-element output
- compare how easy it is to expose builder-friendly hooks

The first component to build should be:

- `Hero`

And it should expose:

- headline
- subheadline
- theme variant
- alignment
- background token
- spacing token
- named parts for important internal regions

Implemented:

- [Hero contract](/Users/code123/shurale/grapesjs-web-builder/component-source/HERO_CONTRACT.md)
- [Svelte Hero](/Users/code123/shurale/grapesjs-web-builder/component-source/svelte/Hero.ce.svelte)
- [Lit Hero](/Users/code123/shurale/grapesjs-web-builder/component-source/lit/Hero.ts)
