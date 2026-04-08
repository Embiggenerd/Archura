import { h as head, e as escape_html, a as attr_class, b as attr } from "../../chunks/renderer.js";
/* empty css                      */
const pages = [{ "id": "home", "component": { "type": "wrapper", "components": [{ "type": "builder-hero", "tagName": "builder-hero-lit", "attributes": { "headline": "Move with confidence", "subheadline": "Fast quotes, reliable crews, and a polished experience from the first visit.", "theme": "brand", "align": "center", "surface": "#6f2f17", "accent": "#f1b07a", "space-y": "clamp(4rem, 10vw, 7rem)" }, "style": { "max-width": "100%", "text-align": "center" } }] } }];
const styles = [];
const assets = [];
const symbols = [];
const sampleProject = {
  pages,
  styles,
  assets,
  symbols
};
function _page($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let editorReady = false;
    let status = "Loading GrapesJS runtime...";
    let projectPreview = JSON.stringify(sampleProject, null, 2);
    let heroPreview = JSON.stringify(extractHeroSummary(sampleProject), null, 2);
    let runtimePreview = "No runtime diagnostics yet.";
    let selectedPart = "headline";
    let partControls = {
      headline: {
        color: "#f6e7d8",
        fontSize: "clamp(3rem, 8vw, 6.5rem)",
        letterSpacing: "-0.08em",
        textTransform: "none"
      }
    };
    function extractHeroSummary(projectData) {
      const firstPage = projectData?.pages?.[0];
      const firstComponent = firstPage?.component?.components?.[0];
      return {
        type: firstComponent?.type ?? null,
        tagName: firstComponent?.tagName ?? null,
        attributes: firstComponent?.attributes ?? {},
        style: firstComponent?.style ?? {},
        parts: [
          "section",
          "eyebrow",
          "headline",
          "subheadline",
          "actions",
          "primary-action",
          "secondary-action"
        ]
      };
    }
    head("1uha8ag", $$renderer2, ($$renderer3) => {
      $$renderer3.title(($$renderer4) => {
        $$renderer4.push(`<title>GrapesJS Web Builder Example</title>`);
      });
    });
    $$renderer2.push(`<div class="layout svelte-1uha8ag"><section class="editor-shell svelte-1uha8ag"><div class="toolbar svelte-1uha8ag"><h1 class="svelte-1uha8ag">GrapesJS + Web Components</h1> <p class="svelte-1uha8ag">${escape_html(status)}</p></div> <div${attr_class("editor-host svelte-1uha8ag", void 0, { "ready": editorReady })}></div></section> <aside class="sidebar svelte-1uha8ag"><h2 class="svelte-1uha8ag">\`::part(...)\` Editor</h2> <p class="svelte-1uha8ag">These controls write real persisted CSS rules targeting the Hero’s exposed parts. This is styling only, not
      content.</p> <div class="part-editor svelte-1uha8ag"><label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Part</span> `);
    $$renderer2.select(
      { value: selectedPart, class: "" },
      ($$renderer3) => {
        $$renderer3.option({ value: "headline" }, ($$renderer4) => {
          $$renderer4.push(`headline`);
        });
        $$renderer3.option({ value: "primary-action" }, ($$renderer4) => {
          $$renderer4.push(`primary-action`);
        });
      },
      "svelte-1uha8ag"
    );
    $$renderer2.push(`</label> `);
    {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Color</span> <input${attr("value", partControls.headline.color)} type="color" class="svelte-1uha8ag"/></label> <label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Font Size</span> <input${attr("value", partControls.headline.fontSize)} type="text" class="svelte-1uha8ag"/></label> <label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Letter Spacing</span> <input${attr("value", partControls.headline.letterSpacing)} type="text" class="svelte-1uha8ag"/></label> <label class="svelte-1uha8ag"><span class="svelte-1uha8ag">Text Transform</span> `);
      $$renderer2.select(
        { value: partControls.headline.textTransform, class: "" },
        ($$renderer3) => {
          $$renderer3.option({ value: "none" }, ($$renderer4) => {
            $$renderer4.push(`none`);
          });
          $$renderer3.option({ value: "uppercase" }, ($$renderer4) => {
            $$renderer4.push(`uppercase`);
          });
          $$renderer3.option({ value: "capitalize" }, ($$renderer4) => {
            $$renderer4.push(`capitalize`);
          });
        },
        "svelte-1uha8ag"
      );
      $$renderer2.push(`</label>`);
    }
    $$renderer2.push(`<!--]--> <button class="apply-button svelte-1uha8ag" type="button">Apply Part Styles</button></div> <h2 class="svelte-1uha8ag">Hero Summary</h2> <p class="svelte-1uha8ag">This compact view should show the actual persisted values GrapesJS is editing on the selected Hero instance,
      including the host CSS variables.</p> <pre class="svelte-1uha8ag">${escape_html(heroPreview)}</pre> <h2 class="svelte-1uha8ag">Generated CSS</h2> <p class="svelte-1uha8ag">This should include rules like \`builder-hero-lit::part(headline)\` or \`builder-hero-svelte::part(headline)\`.</p> <pre class="svelte-1uha8ag">${escape_html("No CSS rules yet.")}</pre> <h2 class="svelte-1uha8ag">Runtime Diagnostics</h2> <p class="svelte-1uha8ag">This inspects the actual rendered custom element inside the GrapesJS iframe so we can compare Lit and Svelte
      runtime behavior.</p> <pre class="svelte-1uha8ag">${escape_html(runtimePreview)}</pre> <h2 class="svelte-1uha8ag">Saved Project Data</h2> <p class="svelte-1uha8ag">This should reflect the real edited Hero instance, including attributes like \`headline\`, \`theme\`, \`surface\`, and
      \`space-y\`.</p> <pre class="svelte-1uha8ag">${escape_html(projectPreview)}</pre></aside></div>`);
  });
}
export {
  _page as default
};
