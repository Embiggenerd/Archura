<svelte:options
  customElement={{
    tag: 'builder-hero-svelte',
    shadow: 'open',
    props: {
      headline: { type: 'String', reflect: true },
      subheadline: { type: 'String', reflect: true },
      theme: { type: 'String', reflect: true },
      align: { type: 'String', reflect: true },
      surface: { type: 'String', reflect: true },
      accent: { type: 'String', reflect: true },
      spaceY: { type: 'String', reflect: true, attribute: 'space-y' }
    }
  }}
/>

<script lang="ts">
  let {
    headline = 'Move with confidence',
    subheadline = 'Fast quotes, reliable crews, and a polished experience from the first visit.',
    theme = 'light',
    align = 'left',
    surface = 'var(--hero-surface, #f6f1e8)',
    accent = 'var(--hero-accent, #c4672d)',
    spaceY = 'var(--hero-space-y, clamp(3rem, 8vw, 6rem))'
  }: {
    headline?: string;
    subheadline?: string;
    theme?: 'light' | 'dark' | 'brand' | string;
    align?: 'left' | 'center' | string;
    surface?: string;
    accent?: string;
    spaceY?: string;
  } = $props();

  const themeInk: Record<string, string> = {
    light: '#171717',
    dark: '#f5f0e8',
    brand: '#f7f3ee'
  };

  const themeMuted: Record<string, string> = {
    light: '#5f5b56',
    dark: '#d1cbc2',
    brand: '#f0d7c9'
  };

  const ink = $derived(themeInk[theme] ?? themeInk.light);
  const muted = $derived(themeMuted[theme] ?? themeMuted.light);
  const alignment = $derived(align === 'center' ? 'center' : 'left');
</script>

<section
  part="section"
  class="hero"
  data-theme={theme}
  data-align={alignment}
  style={`--hero-surface:${surface}; --hero-ink:${ink}; --hero-muted:${muted}; --hero-accent:${accent}; --hero-space-y:${spaceY};`}
>
  <div class="shell">
    <p part="eyebrow" class="eyebrow">Built for fast brand assembly</p>
    <h1 part="headline" class="headline">{headline}</h1>
    <p part="subheadline" class="subheadline">{subheadline}</p>
    <div part="actions" class="actions">
      <button part="primary-action" class="primary-action" type="button">Get a quote</button>
      <button part="secondary-action" class="secondary-action" type="button">See pricing</button>
    </div>
  </div>
</section>

<style>
  :host {
    display: block;
    --hero-surface: #f6f1e8;
    --hero-ink: #171717;
    --hero-muted: #5f5b56;
    --hero-accent: #c4672d;
    --hero-space-y: clamp(3rem, 8vw, 6rem);
    --hero-radius: 2rem;
    --hero-border: color-mix(in srgb, var(--hero-ink) 10%, transparent);
    font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
  }

  .hero {
    background: var(--hero-surface);
    color: var(--hero-ink);
    padding: var(--hero-space-y) clamp(1.5rem, 4vw, 3rem);
    border-radius: var(--hero-radius);
    border: 1px solid var(--hero-border);
  }

  .shell {
    max-width: 56rem;
    margin: 0 auto;
    text-align: left;
  }

  .hero[data-align="center"] .shell {
    text-align: center;
  }

  .eyebrow {
    margin: 0 0 0.875rem;
    color: var(--hero-accent);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .headline {
    margin: 0;
    font-size: clamp(2.5rem, 7vw, 5.5rem);
    line-height: 0.95;
    letter-spacing: -0.05em;
  }

  .subheadline {
    max-width: 42rem;
    margin: 1rem 0 0;
    color: var(--hero-muted);
    font-size: clamp(1rem, 2vw, 1.25rem);
    line-height: 1.55;
  }

  .hero[data-align="center"] .subheadline {
    margin-left: auto;
    margin-right: auto;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.875rem;
    margin-top: 1.75rem;
    justify-content: flex-start;
  }

  .hero[data-align="center"] .actions {
    justify-content: center;
  }

  .primary-action,
  .secondary-action {
    min-height: 2.75rem;
    padding: 0 1.25rem;
    border-radius: 999px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .primary-action {
    border: 0;
    background: var(--hero-accent);
    color: white;
  }

  .secondary-action {
    border: 1px solid var(--hero-border);
    background: transparent;
    color: var(--hero-ink);
  }
</style>
