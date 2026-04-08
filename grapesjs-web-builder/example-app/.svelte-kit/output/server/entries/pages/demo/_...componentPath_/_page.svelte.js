import { g as getContext, h as head, e as escape_html, a as attr_class } from "../../../../chunks/renderer.js";
import "clsx";
import "@sveltejs/kit/internal";
import { i as get } from "../../../../chunks/exports.js";
import "../../../../chunks/utils.js";
import "@sveltejs/kit/internal/server";
import "../../../../chunks/root.js";
import "../../../../chunks/state.svelte.js";
/* empty css                            */
const getStores = () => {
  const stores$1 = getContext("__svelte__");
  return {
    /** @type {typeof page} */
    page: {
      subscribe: stores$1.page.subscribe
    },
    /** @type {typeof navigating} */
    navigating: {
      subscribe: stores$1.navigating.subscribe
    },
    /** @type {typeof updated} */
    updated: stores$1.updated
  };
};
const page = {
  subscribe(fn) {
    const store = getStores().page;
    return store.subscribe(fn);
  }
};
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let editorReady = false;
    head("okjez9", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>GrapesJS Component Editor</title>`);
      });
    });
    $$renderer2.push(`<div class="page svelte-okjez9"><div class="topbar svelte-okjez9"><div class="left svelte-okjez9"><strong>GrapesJS Component Editor</strong> <span class="svelte-okjez9">${escape_html(get(page).params.componentPath)}</span></div> <div class="right svelte-okjez9"><a href="/demo" class="svelte-okjez9">Default Demo</a></div></div> `);
    {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div${attr_class("editor-host svelte-okjez9", void 0, { "ready": editorReady })}></div></div>`);
  });
}
export {
  _page as default
};
