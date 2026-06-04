import { css, html } from 'lit';
import { Base } from '../base/Base.js';

/**
 * Heading Component
 * 
 * grapesTagName: my-heading
 * 
 * Public Styling API (CSS Custom Properties):
 * --heading-color, --heading-size, --heading-weight, --heading-spacing, etc.
 */
export class Heading extends Base {
  static grapesTagName = 'my-heading';

  static styles = [
    Base.styles || '',
    css`
      :host {
        --heading-color: #111827;
        --heading-size: 2.25rem;
        --heading-weight: 700;
        --heading-spacing: -0.02em;
        --heading-line-height: 1.2;
      }

      h1, h2, h3 {
        color: var(--heading-color);
        font-size: var(--heading-size);
        font-weight: var(--heading-weight);
        letter-spacing: var(--heading-spacing);
        line-height: var(--heading-line-height);
        margin: 0;
      }
    `
  ];

  static properties = {
    level: { type: Number },
    text: { type: String }
  };

  constructor() {
    super();
    this.level = 1;
    this.text = 'Beautiful Heading';
  }

  render() {
    const Tag = `h${this.level}`;
    return html`<${Tag}>${this.text}</${Tag}>`;
  }
}

customElements.define(Heading.grapesTagName, Heading);
