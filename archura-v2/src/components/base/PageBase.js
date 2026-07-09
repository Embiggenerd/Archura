import { LitElement } from 'lit';

/**
 * Base class for page compositions. Pages render into light DOM so the editor
 * can select and edit the components they compose (GrapesJS cannot reach into
 * shadow roots, and shadow event retargeting would make children unselectable).
 *
 * Constraints this imposes on page authors:
 * - `static styles` is silently ignored (no shadow root to adopt it). Keep
 *   pages nearly style-free: structure via wrapper elements, appearance owned
 *   by the leaf components.
 * - `<slot>` does not work.
 * - Page markup is exposed to document CSS.
 */
export class PageBase extends LitElement {
  createRenderRoot() {
    return this;
  }
}
