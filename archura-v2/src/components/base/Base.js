import { LitElement, css, html } from 'lit';

export class Base extends LitElement {
  static styles = css`
    :host {
      --display: block;
      --position: relative;
      --top: auto;
      --right: auto;
      --bottom: auto;
      --left: auto;
      --width: 100%;
      --min-width: auto;
      --max-width: none;
      --height: auto;
      --min-height: auto;
      --max-height: none;
      --margin: 0;
      --padding: 1.5rem;
      --border: 1px solid #e5e7eb;
      --border-radius: 12px;
      --background-color: #ffffff;
      --color: #111827;
      --box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
      --opacity: 1;
      --cursor: default;
      --transition: all 0.2s ease;
      --transform: none;
      --font-family: system-ui, -apple-system, sans-serif;
      --font-size: 1rem;
      --font-weight: 400;
      --line-height: 1.5;
      --text-align: left;
      --flex-direction: row;
      --justify-content: flex-start;
      --align-items: stretch;

      display: var(--display);
      position: var(--position);
      top: var(--top);
      right: var(--right);
      bottom: var(--bottom);
      left: var(--left);
      width: var(--width);
      min-width: var(--min-width);
      max-width: var(--max-width);
      height: var(--height);
      min-height: var(--min-height);
      max-height: var(--max-height);
      margin: var(--margin);
      padding: var(--padding);
      border: var(--border);
      border-radius: var(--border-radius);
      background-color: var(--background-color);
      color: var(--color);
      box-shadow: var(--box-shadow);
      opacity: var(--opacity);
      cursor: var(--cursor);
      transition: var(--transition);
      transform: var(--transform);
      font-family: var(--font-family);
      font-size: var(--font-size);
      font-weight: var(--font-weight);
      line-height: var(--line-height);
      text-align: var(--text-align);
      flex-direction: var(--flex-direction);
      justify-content: var(--justify-content);
      align-items: var(--align-items);
    }
  `;

  static properties = {
    variant: { type: String },
  };

  constructor() {
    super();
    this.variant = 'default';
  }

  render() {
    return html`<slot></slot>`;
  }
}
