import { h as head, a as attr_class } from "../../../chunks/renderer.js";
/* empty css                         */
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let editorReady = false;
    head("1du1zi4", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>GrapesJS Demo Comparison</title>`);
      });
    });
    $$renderer2.push(`<div class="page svelte-1du1zi4"><div class="topbar svelte-1du1zi4"><div class="left svelte-1du1zi4"><strong>GrapesJS Demo</strong> <span class="svelte-1du1zi4">Minimal shell, mostly default editor UI, Lit-first component rendering</span></div> <div class="right svelte-1du1zi4"><a href="/" class="svelte-1du1zi4">Instrumented View</a></div></div> <div${attr_class("editor-host svelte-1du1zi4", void 0, { "ready": editorReady })}></div></div>`);
  });
}
export {
  _page as default
};
