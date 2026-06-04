const moduleUrl = "/@fs//Users/code123/shurale/grapesjs-web-builder/component-source/cards/Card.js";
const wrapperTagName = "exported-cards-card-001";
const html = "<my-card data-gjs-highlightable=\"true\" id=\"ixve\" data-gjs-type=\"my-card\" draggable=\"true\" class=\"gjs-selected\"></my-card>";
const css = "* { box-sizing: border-box; }\n#ixve { background-color: rgb(123, 125, 41); font-family: \"Courier New\", Courier, monospace; }";

await import(moduleUrl);

class ExportedComponentWrapper extends HTMLElement {
  connectedCallback() {
    const shadowRoot = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    if (shadowRoot.childNodes.length > 0) {
      return;
    }

    shadowRoot.innerHTML = `<style>${css}</style>${html}`;
  }
}

if (!customElements.get(wrapperTagName)) {
  customElements.define(wrapperTagName, ExportedComponentWrapper);
}
