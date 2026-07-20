import { LitElement, css, html } from 'lit';

export class Base extends LitElement {
  // Defaults live in var() fallbacks (not :host declarations) so site-level
  // theme tokens set on <body> inherit through; an instance-level custom prop
  // still wins over both.
  static styles = css`
    :host {
      display: var(--display, block);
      position: var(--position, relative);
      top: var(--top, auto);
      right: var(--right, auto);
      bottom: var(--bottom, auto);
      left: var(--left, auto);
      width: var(--width, 100%);
      min-width: var(--min-width, auto);
      max-width: var(--max-width, none);
      height: var(--height, auto);
      min-height: var(--min-height, auto);
      max-height: var(--max-height, none);
      margin: var(--margin, 0);
      padding: var(--padding, 1.5rem);
      border: var(--border, 1px solid #e5e7eb);
      border-radius: var(--border-radius, 12px);
      background-color: var(--background-color, #ffffff);
      color: var(--color, #111827);
      box-shadow: var(--box-shadow, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      opacity: var(--opacity, 1);
      cursor: var(--cursor, default);
      transition: var(--transition, all 0.2s ease);
      transform: var(--transform, none);
      font-family: var(--font-family, system-ui, -apple-system, sans-serif);
      font-size: var(--font-size, 1rem);
      font-weight: var(--font-weight, 400);
      line-height: var(--line-height, 1.5);
      text-align: var(--text-align, left);
      flex-direction: var(--flex-direction, row);
      justify-content: var(--justify-content, flex-start);
      align-items: var(--align-items, stretch);
    }

    :host(:hover) {
      background-color: var(--hover-background-color, var(--background-color, #ffffff));
      color: var(--hover-color, var(--color, #111827));
      box-shadow: var(--hover-box-shadow, var(--box-shadow, 0 10px 15px -3px rgb(0 0 0 / 0.1)));
      transform: var(--hover-transform, var(--transform, none));
    }
  `;

  // Properties common to every component. `client-key` (the Archura tenant
  // publishable key) + `api` (the Archura API base) are the identity every
  // embeddable/data-connected component needs to talk to Archura. Like all
  // props they can be set as attributes or from URL search params.
  static properties = {
    variant: { type: String },
    clientKey: { type: String, attribute: 'client-key' },
    api: { type: String },
  };

  constructor() {
    super();
    this.variant = 'default';
    this.clientKey = '';
    this.api = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this.#applySearchParams();
  }

  // A component's properties can be set as attributes OR from the page's URL
  // search params — every component (shadow or light DOM) supports both, which
  // makes any component demoable/configurable by URL. Explicit attributes win;
  // params only fill in what wasn't passed, and only for declared properties.
  // In the editor the component lives in the GrapesJS canvas iframe (empty
  // search), so this never picks up the editor's own URL params.
  #applySearchParams() {
    const props = this.constructor.elementProperties;
    if (!props || typeof location === 'undefined') return;
    const params = new URLSearchParams(location.search);
    if (![...params.keys()].length) return;
    for (const [name, options] of props) {
      if (options.attribute === false) continue;
      const attr = typeof options.attribute === 'string' ? options.attribute : String(name).toLowerCase();
      if (!this.hasAttribute(attr) && params.has(attr)) {
        this.setAttribute(attr, params.get(attr));
      }
    }
  }

  firstUpdated() {
    this.#setupAnimation();
    this.#setupInlineEditing();
  }

  // Double-click a [data-edit] element to edit its text in place. The commit
  // is an event, not a DOM/attribute write: the editor bridges it into the
  // GrapesJS model so export, undo, and the traits panel stay authoritative.
  // Editor-only: armed only inside the editor canvas (the controller marks
  // its document) — published sites and embeds must never be editable.
  #setupInlineEditing() {
    if (!this.ownerDocument?.documentElement?.hasAttribute('data-archura-editor')) return;
    for (const el of this.renderRoot.querySelectorAll('[data-edit]')) {
      el.addEventListener('dblclick', () => this.#beginEdit(el));
    }
  }

  #beginEdit(el) {
    if (el.isContentEditable) return;
    const trait = el.getAttribute('data-edit');
    const original = el.innerText;
    // Contenteditable typing destroys the text nodes and marker comments Lit
    // manages inside this element; a later Lit render then writes into dead
    // references and throws. Keep the original nodes and restore them before
    // any re-render can run.
    const originalNodes = [...el.childNodes];
    let done = false;

    el.setAttribute('contenteditable', 'plaintext-only');
    if (!el.isContentEditable) el.setAttribute('contenteditable', 'true');
    el.focus();
    const doc = el.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(el);
    const selection = doc.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const finish = (commit) => {
      if (done) return;
      done = true;
      el.removeAttribute('contenteditable');
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      const value = el.innerText.trim();
      el.replaceChildren(...originalNodes);
      if (!commit || value === original.trim()) {
        return;
      }
      this.dispatchEvent(
        new CustomEvent('archura:text-edit', {
          bubbles: true,
          composed: true,
          detail: { trait, value },
        })
      );
    };
    const onBlur = () => finish(true);
    const onKey = (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        finish(false);
      }
    };
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
  }

  #setupAnimation() {
    if (this.getAttribute('animation') !== 'fade-up') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.style.opacity = '0';
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();
          this.style.opacity = '';
          this.animate(
            [
              { opacity: 0, transform: 'translateY(16px)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 500, easing: 'ease-out' }
          );
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(this);
  }

  render() {
    return html`<slot></slot>`;
  }
}
