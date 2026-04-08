import { LitElement, css, html } from 'lit';
import { property } from 'lit/decorators.js';
import './BuilderButtonLit';

export class BuilderHeroLit extends LitElement {
  static override shadowRootOptions = { ...LitElement.shadowRootOptions, mode: 'open' as const };

  @property({ type: String, reflect: true }) headline = 'Move with confidence';
  @property({ type: String, reflect: true }) subheadline =
    'Fast quotes, reliable crews, and a polished experience from the first visit.';
  @property({ type: String, reflect: true }) theme: 'light' | 'dark' | 'brand' = 'light';
  @property({ type: String, reflect: true }) align: 'left' | 'center' = 'left';
  @property({ type: String, reflect: true }) surface = 'var(--hero-surface, #f6f1e8)';
  @property({ type: String, reflect: true }) accent = 'var(--hero-accent, #c4672d)';
  @property({ type: String, reflect: true, attribute: 'space-y' }) spaceY =
    'var(--hero-space-y, clamp(3rem, 8vw, 6rem))';

  editorStyles: Record<string, string> = {};

  updateStyles(styles: Record<string, string> = {}) {
    this.editorStyles = { ...styles };

    for (const [property, value] of Object.entries(this.editorStyles)) {
      if (value == null || value === '') {
        this.style.removeProperty(property);
      } else {
        this.style.setProperty(property, value);
      }
    }

    this.requestUpdate();
  }

  applyEditorAttributes(attributes: Record<string, string> = {}) {
    const attrEntries = Object.entries(attributes);
    for (const [name, value] of attrEntries) {
      if (name.startsWith('data-gjs-') || name === 'id' || name === 'draggable') continue;
      if (value == null) continue;
      this.setAttribute(name, value);
    }
  }

  private get ink() {
    return {
      light: '#171717',
      dark: '#f5f0e8',
      brand: '#f7f3ee'
    }[this.theme] ?? '#171717';
  }

  private get muted() {
    return {
      light: '#5f5b56',
      dark: '#d1cbc2',
      brand: '#f0d7c9'
    }[this.theme] ?? '#5f5b56';
  }

  override render() {
    return html`
      <section
        part="section"
        class="hero"
        data-theme=${this.theme}
        data-align=${this.align}
        style=${`--hero-surface:${this.surface}; --hero-ink:${this.ink}; --hero-muted:${this.muted}; --hero-accent:${this.accent}; --hero-space-y:${this.spaceY};`}
      >
        <div class="shell">
          <p part="eyebrow" class="eyebrow">Built for fast brand assembly</p>
          <h1 part="headline" class="headline">${this.headline}</h1>
          <p part="subheadline" class="subheadline">${this.subheadline}</p>
          <div part="actions" class="actions">
            <builder-button-lit
              label="Get a quote"
              style=${`--button-bg:${this.accent}; --button-ink:#ffffff; --button-border-color:transparent;`}
            ></builder-button-lit>
            <builder-button-lit
              label="See pricing"
              style=${`--button-bg:transparent; --button-ink:${this.ink}; --button-border-color:var(--hero-border);`}
            ></builder-button-lit>
          </div>
        </div>
      </section>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      border-style: solid;
      border-width: 0;
      border-color: transparent;
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
  `;
}

if (!customElements.get('builder-hero-lit')) {
  customElements.define('builder-hero-lit', BuilderHeroLit);
}
