import { J as is_array, G as get_prototype_of, y as object_prototype, _ as setContext, g as getContext, a0 as ensure_array_like, a1 as attr_class, e as escape_html, a2 as spread_props, $ as derived, a3 as attr_style, a4 as stringify, a5 as attributes, a6 as bind_props, a7 as element, a8 as attr, a9 as clsx, aa as head } from "../../chunks/renderer.js";
import "clsx";
const empty = [];
function snapshot(value, skip_warning = false, no_tojson = false) {
  return clone$1(value, /* @__PURE__ */ new Map(), "", empty, null, no_tojson);
}
function clone$1(value, cloned, path, paths, original = null, no_tojson = false) {
  if (typeof value === "object" && value !== null) {
    var unwrapped = cloned.get(value);
    if (unwrapped !== void 0) return unwrapped;
    if (value instanceof Map) return (
      /** @type {Snapshot<T>} */
      new Map(value)
    );
    if (value instanceof Set) return (
      /** @type {Snapshot<T>} */
      new Set(value)
    );
    if (is_array(value)) {
      var copy = (
        /** @type {Snapshot<any>} */
        Array(value.length)
      );
      cloned.set(value, copy);
      if (original !== null) {
        cloned.set(original, copy);
      }
      for (var i = 0; i < value.length; i += 1) {
        var element2 = value[i];
        if (i in value) {
          copy[i] = clone$1(element2, cloned, path, paths, null, no_tojson);
        }
      }
      return copy;
    }
    if (get_prototype_of(value) === object_prototype) {
      copy = {};
      cloned.set(value, copy);
      if (original !== null) {
        cloned.set(original, copy);
      }
      for (var key of Object.keys(value)) {
        copy[key] = clone$1(
          // @ts-expect-error
          value[key],
          cloned,
          path,
          paths,
          null,
          no_tojson
        );
      }
      return copy;
    }
    if (value instanceof Date) {
      return (
        /** @type {Snapshot<T>} */
        structuredClone(value)
      );
    }
    if (typeof /** @type {T & { toJSON?: any } } */
    value.toJSON === "function" && !no_tojson) {
      return clone$1(
        /** @type {T & { toJSON(): any } } */
        value.toJSON(),
        cloned,
        path,
        paths,
        // Associate the instance with the toJSON clone
        value
      );
    }
  }
  if (value instanceof EventTarget) {
    return (
      /** @type {Snapshot<T>} */
      value
    );
  }
  try {
    return (
      /** @type {Snapshot<T>} */
      structuredClone(value)
    );
  } catch (e) {
    return (
      /** @type {Snapshot<T>} */
      value
    );
  }
}
function clone(value) {
  return structuredClone(value);
}
function createRichTextDoc(text = "") {
  return {
    document_id: "page_1",
    nodes: {
      page_1: {
        id: "page_1",
        type: "page",
        body: ["text_1"]
      },
      text_1: {
        id: "text_1",
        type: "text",
        content: {
          text,
          annotations: []
        }
      }
    }
  };
}
function getRichTextPlainText(doc) {
  const documentNode = doc?.nodes?.[doc?.document_id];
  if (!documentNode || !Array.isArray(documentNode.body)) return "";
  return documentNode.body.map((nodeId) => doc.nodes[nodeId]?.content?.text ?? "").join("\n").trim();
}
function defaultValueForField(field) {
  if (field.type === "rich_text") return createRichTextDoc(field.defaultValue ?? "");
  return field.defaultValue ?? null;
}
function createComponentInstance(definition, id = `${definition.id}_1`) {
  const props = {};
  const richText = {};
  for (const [key, field] of Object.entries(definition.fields ?? {})) {
    const value = defaultValueForField(field);
    if (field.type === "rich_text") {
      richText[key] = value;
    } else {
      props[key] = value;
    }
  }
  return {
    id,
    type: definition.id,
    props,
    richText
  };
}
function createPageState(definitions = [], instances = []) {
  const registry = new Map(definitions.map((definition) => [definition.id, definition]));
  return {
    registry,
    instances: clone(instances)
  };
}
function addComponentInstance(pageState, definitionId, id) {
  const definition = pageState.registry.get(definitionId);
  if (!definition) {
    throw new Error(`Unknown component definition: ${definitionId}`);
  }
  const instance = createComponentInstance(definition, `${definitionId}_${pageState.instances.length + 1}`);
  return {
    ...pageState,
    instances: [...pageState.instances, instance]
  };
}
function updateComponentProp(pageState, instanceId, key, value) {
  return {
    ...pageState,
    instances: pageState.instances.map(
      (instance) => instance.id === instanceId ? { ...instance, props: { ...instance.props, [key]: value } } : instance
    )
  };
}
function updateComponentRichText(pageState, instanceId, key, doc) {
  return {
    ...pageState,
    instances: pageState.instances.map(
      (instance) => instance.id === instanceId ? { ...instance, richText: { ...instance.richText, [key]: clone(doc) } } : instance
    )
  };
}
function getRenderProps(instance) {
  const richTextProps = Object.fromEntries(
    Object.entries(instance.richText ?? {}).map(([key, doc]) => [key, getRichTextPlainText(doc)])
  );
  return {
    ...instance.props,
    ...richTextProps
  };
}
const SVARO_STATE = Symbol("SVARO_STATE");
class BuilderState {
  constructor(config2) {
    this._config = [];
    this._page = createPageState([]);
    this._selectedId = null;
    this._config = config2;
    this._page = createPageState(config2);
  }
  get config() {
    return this._config;
  }
  get instances() {
    return this._page.instances;
  }
  get selectedId() {
    return this._selectedId;
  }
  get selectedInstance() {
    return this.instances.find((instance) => instance.id === this._selectedId) ?? null;
  }
  add(definitionId) {
    this._page = addComponentInstance(this._page, definitionId);
  }
  select(id) {
    this._selectedId = id;
  }
  removeSelected() {
    if (!this._selectedId) return;
    this._page = {
      ...this._page,
      instances: this.instances.filter((instance) => instance.id !== this._selectedId)
    };
    this._selectedId = null;
  }
  updateProp(instanceId, key, value) {
    this._page = updateComponentProp(this._page, instanceId, key, value);
  }
  updateRichText(instanceId, key, doc) {
    this._page = updateComponentRichText(this._page, instanceId, key, doc);
  }
  getRenderProps(instance) {
    return getRenderProps(instance);
  }
}
function createBuilderState(config2) {
  const state = new BuilderState(config2);
  setContext(SVARO_STATE, state);
  return state;
}
function getBuilderState() {
  return getContext(SVARO_STATE);
}
function Canvas($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const builder = getBuilderState();
    $$renderer2.push(`<main class="canvas svelte-1tab0mv">`);
    if (builder.instances.length === 0) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="empty svelte-1tab0mv">Add a component from the left to start building the page.</div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      $$renderer2.push(`<!--[-->`);
      const each_array = ensure_array_like(builder.instances);
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let instance = each_array[$$index];
        const Component = builder.config.find((definition) => definition.id === instance.type)?.render;
        $$renderer2.push(`<button type="button"${attr_class("component-shell svelte-1tab0mv", void 0, { "selected": builder.selectedId === instance.id })}><div class="component-label svelte-1tab0mv">${escape_html(instance.type)}</div> `);
        if (Component) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="component-view">`);
          Component($$renderer2, spread_props([builder.getRenderProps(instance)]));
          $$renderer2.push(`<!----></div>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--></button>`);
      }
      $$renderer2.push(`<!--]-->`);
    }
    $$renderer2.push(`<!--]--></main>`);
  });
}
function ComponentList($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const builder = getBuilderState();
    $$renderer2.push(`<aside class="panel svelte-1s9nus6"><h2 class="svelte-1s9nus6">Components</h2> <div class="list svelte-1s9nus6"><!--[-->`);
    const each_array = ensure_array_like(builder.config);
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let component = each_array[$$index];
      $$renderer2.push(`<button type="button" class="svelte-1s9nus6">Add ${escape_html(component.name)}</button>`);
    }
    $$renderer2.push(`<!--]--></div></aside>`);
  });
}
const SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });
function get_char_length(str) {
  return [...SEGMENTER.segment(str)].length;
}
function char_slice(str, start, end = void 0) {
  const segments = [...SEGMENTER.segment(str)];
  return segments.slice(start, end).map((s) => s.segment).join("");
}
function join_annotated_text(first_text, second_text) {
  const { text: first_text_content, annotations: first_annotations } = first_text;
  const { text: second_text_content, annotations: second_annotations } = second_text;
  const joined_text = first_text_content + second_text_content;
  const joined_annotations = [...first_annotations];
  const offset = get_char_length(first_text_content);
  for (const { start_offset, end_offset, node_id } of second_annotations) {
    const shifted_annotation = {
      start_offset: start_offset + offset,
      end_offset: end_offset + offset,
      node_id
    };
    const last_annotation = joined_annotations[joined_annotations.length - 1];
    if (last_annotation && last_annotation.end_offset === shifted_annotation.start_offset && // annotations are adjacent
    last_annotation.node_id === shifted_annotation.node_id) {
      last_annotation.end_offset = shifted_annotation.end_offset;
    } else {
      joined_annotations.push(shifted_annotation);
    }
  }
  return { text: joined_text, annotations: joined_annotations };
}
function snake_to_pascal(str) {
  return str.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}
function traverse(node_id, schema2, nodes) {
  const json = [];
  const visited = {};
  const visit = (node) => {
    if (!node || visited[node.id]) {
      return;
    }
    visited[node.id] = true;
    for (const [property_name, value] of Object.entries(node)) {
      const property_definition = schema2[node.type].properties[property_name];
      if (property_definition?.type === "node_array") {
        for (const v of value) {
          if (typeof v === "string") {
            visit(nodes[v]);
          }
        }
      } else if (property_definition?.type === "node") {
        visit(nodes[value]);
      } else if (property_definition?.type === "annotated_text") {
        for (const annotation of value.annotations) {
          visit(nodes[annotation.node_id]);
        }
      }
    }
    json.push(structuredClone(node));
  };
  visit(nodes[node_id]);
  return json;
}
function get_selection_range(selection) {
  if (selection && selection.type !== "property") {
    return {
      start_offset: Math.min(selection.anchor_offset, selection.focus_offset),
      end_offset: Math.max(selection.anchor_offset, selection.focus_offset)
    };
  } else {
    return null;
  }
}
function is_selection_collapsed(selection) {
  if (selection && selection.type !== "property") {
    return selection.anchor_offset === selection.focus_offset;
  } else {
    return false;
  }
}
function create_visibility_culler(svedit) {
  const index_map = /* @__PURE__ */ new Map();
  const visible_roots = /* @__PURE__ */ new Set();
  let doc_snapshot = null;
  function is_near_viewport(path) {
    if (path.length < 3) return true;
    const parent_array = `${path[0]}.${path[1]}`;
    if (!index_map.has(parent_array)) return true;
    const root_key = `${path[0]}.${path[1]}.${path[2]}`;
    return visible_roots.has(root_key);
  }
  return {
    get visible_child_indices() {
      return index_map;
    },
    get doc_snapshot() {
      return doc_snapshot;
    },
    is_near_viewport
  };
}
function create_gap_computation(svedit) {
  const culler = create_visibility_culler();
  svedit.is_near_viewport = culler.is_near_viewport;
  let caret_gap_key = derived(() => {
    const s = svedit.session.selection;
    if (s?.type !== "node" || s.anchor_offset !== s.focus_offset) return null;
    return `${s.path.join(".")}-gap-${s.anchor_offset}`;
  });
  class PathGapData {
    gaps = [];
  }
  const path_gap_signals = /* @__PURE__ */ new Map();
  function get_or_create_gap_signal(path_str) {
    let sig = path_gap_signals.get(path_str);
    if (!sig) {
      sig = new PathGapData();
      path_gap_signals.set(path_str, sig);
    }
    return sig;
  }
  svedit.insertion_gap_data = {
    get_gaps: get_or_create_gap_signal,
    get caret_gap_key() {
      return caret_gap_key();
    }
  };
}
function NodeSelectionMarkers($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const svedit = getContext("svedit");
    let selected_node_paths = derived(get_selected_node_paths);
    function get_selected_node_paths() {
      const paths = [];
      const selection = svedit.session.selection;
      if (!selection) return;
      if (selection.type !== "node" || selection.anchor_offset === selection.focus_offset) return;
      const start = Math.min(selection.anchor_offset, selection.focus_offset);
      const end = Math.max(selection.anchor_offset, selection.focus_offset);
      for (let index = start; index < end; index++) {
        paths.push([...selection.path, index]);
      }
      return paths;
    }
    if (svedit.session.selection?.type === "property") {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<div class="selected-property-overlay svelte-1944zef"${attr_style(`position-anchor: --${stringify(svedit.session.selection.path.join("-"))};`)}></div>`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> `);
    if (selected_node_paths()) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<!--[-->`);
      const each_array = ensure_array_like(selected_node_paths());
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let path = each_array[$$index];
        $$renderer2.push(`<div class="selected-node-overlay svelte-1944zef"${attr_style(`position-anchor: --${stringify(path.join("-"))};`)}></div>`);
      }
      $$renderer2.push(`<!--]-->`);
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function Svedit($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let {
      session,
      editable = false,
      path,
      class: css_class,
      autocapitalize = "on",
      spellcheck = "true"
    } = $$props;
    let canvas_el;
    let root_node = derived(() => session.get(path));
    let Overlays = derived(() => session.config.system_components?.Overlays);
    let NodeSelectionMarkers$1 = derived(() => session.config.system_components?.NodeSelectionMarkers ?? NodeSelectionMarkers);
    let RootComponent = derived(() => session.config.node_components[snake_to_pascal(root_node().type)]);
    let is_composing = false;
    let canvas_focused = false;
    const context = {
      get session() {
        return session;
      },
      get editable() {
        return editable;
      },
      set editable(value) {
        editable = value;
      },
      get is_composing() {
        return is_composing;
      },
      get canvas_el() {
        return canvas_el;
      },
      get canvas_focused() {
        return canvas_focused;
      },
      focus_canvas
    };
    setContext("svedit", context);
    create_gap_computation(context);
    getContext("key_mapper");
    function focus_canvas() {
    }
    $$renderer2.push(`<div class="svedit">`);
    if (NodeSelectionMarkers$1()) {
      $$renderer2.push("<!--[-->");
      NodeSelectionMarkers$1()($$renderer2, {});
      $$renderer2.push("<!--]-->");
    } else {
      $$renderer2.push("<!--[!-->");
      $$renderer2.push("<!--]-->");
    }
    $$renderer2.push(` `);
    if (Overlays()) {
      $$renderer2.push("<!--[0-->");
      if (Overlays()) {
        $$renderer2.push("<!--[-->");
        Overlays()($$renderer2, {});
        $$renderer2.push("<!--]-->");
      } else {
        $$renderer2.push("<!--[!-->");
        $$renderer2.push("<!--]-->");
      }
    } else {
      $$renderer2.push("<!--[-1-->");
    }
    $$renderer2.push(`<!--]--> <div${attributes(
      {
        class: `svedit-canvas ${stringify(css_class)}`,
        contenteditable: editable ? "true" : "false",
        tabindex: "-1",
        autocapitalize,
        spellcheck,
        ...{}
      },
      "svelte-k7kwrn",
      {
        "hide-selection": session.selection?.type === "node",
        "node-caret": session.selection?.type === "node" && session.selection.anchor_offset === session.selection.focus_offset,
        "property-selection": session.selection?.type === "property"
      }
    )}>`);
    if (RootComponent()) {
      $$renderer2.push("<!--[-->");
      RootComponent()($$renderer2, { path });
      $$renderer2.push("<!--]-->");
    } else {
      $$renderer2.push("<!--[!-->");
      $$renderer2.push("<!--]-->");
    }
    $$renderer2.push(`</div></div>`);
    bind_props($$props, { editable, focus_canvas });
  });
}
function AnnotatedTextProperty($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const svedit = getContext("svedit");
    let {
      path,
      class: css_class,
      placeholder = "",
      tag = "div",
      style = "",
      $$slots,
      $$events,
      ...rest
    } = $$props;
    let is_focused = derived(() => {
      return svedit.session.selection?.type === "text" && path.join(".") === svedit.session.selection?.path.join(".");
    });
    let plain_text = derived(() => svedit.session.get(path).text);
    let is_empty = derived(() => get_char_length(plain_text()) === 0 && !(svedit.is_composing && is_focused()));
    let is_collapsed = derived(() => is_focused() && svedit.session.selection?.anchor_offset == svedit.session.selection?.focus_offset);
    let selection_highlight_range = derived(() => {
      if (svedit.canvas_focused) return null;
      if (is_collapsed()) return null;
      if (!is_focused()) return null;
      if (svedit.session.active_annotation()) return null;
      const sel = svedit.session.selection;
      if (!sel || sel.type !== "text") return null;
      return get_selection_range(sel);
    });
    let fragments = derived(() => get_fragments(svedit.session.get(path).text, svedit.session.get(path).annotations, selection_highlight_range()));
    function get_fragments(text, annotations, selection_highlight_range2) {
      let fragments2 = [];
      let last_index = 0;
      const ranges = [
        ...annotations,
        ...selection_highlight_range2 ? [selection_highlight_range2] : []
      ].sort((a, b) => a.start_offset - b.start_offset);
      for (const range of ranges) {
        if (range.start_offset > last_index) {
          fragments2.push(char_slice(text, last_index, range.start_offset));
        }
        const content = char_slice(text, range.start_offset, range.end_offset);
        if ("node_id" in range) {
          const node = svedit.session.get(range.node_id);
          if (!node) throw new Error(`Node not found for annotation ${range.node_id}`);
          fragments2.push({
            type: "annotation",
            node,
            content,
            annotation_index: annotations.indexOf(
              /** @type {Annotation} */
              range
            )
          });
        } else {
          fragments2.push({ type: "selection_highlight", content });
        }
        last_index = range.end_offset;
      }
      if (last_index < get_char_length(text)) {
        fragments2.push(char_slice(text, last_index));
      }
      return fragments2;
    }
    element(
      $$renderer2,
      tag,
      () => {
        $$renderer2.push(`${attributes(
          {
            "data-type": "text",
            "data-path": path.join("."),
            style: `anchor-name: --${stringify(path.join("-"))};${stringify(style)}`,
            class: `text svedit-selectable ${stringify(css_class)}`,
            placeholder,
            ...rest
          },
          "svelte-4qz6c6",
          {
            empty: is_empty(),
            focused: is_focused(),
            editable: svedit.editable
          }
        )}`);
      },
      () => {
        $$renderer2.push(`<!--[-->`);
        const each_array = ensure_array_like(fragments());
        for (let index = 0, $$length = each_array.length; index < $$length; index++) {
          let fragment = each_array[index];
          if (typeof fragment === "string") {
            $$renderer2.push("<!--[0-->");
            $$renderer2.push(`${escape_html(fragment)}`);
          } else if (fragment.type === "selection_highlight") {
            $$renderer2.push("<!--[1-->");
            $$renderer2.push(`<span class="selection-highlight svelte-4qz6c6" style="anchor-name: --selection-highlight;">${escape_html(fragment.content)}</span>`);
          } else if (fragment.type === "annotation") {
            $$renderer2.push("<!--[2-->");
            const AnnotationComponent = svedit.session.config.node_components[snake_to_pascal(fragment.node.type)];
            if (AnnotationComponent) {
              $$renderer2.push("<!--[-->");
              AnnotationComponent($$renderer2, {
                path: [...path, "annotations", fragment.annotation_index, "node_id"],
                content: fragment.content
              });
              $$renderer2.push("<!--]-->");
            } else {
              $$renderer2.push("<!--[!-->");
              $$renderer2.push("<!--]-->");
            }
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]-->`);
        }
        $$renderer2.push(`<!--]-->`);
        if (!is_focused() || !is_empty()) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<br/>`);
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      }
    );
  });
}
function Node$1($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const svedit = getContext("svedit");
    let {
      path,
      children,
      tag = "div",
      class: css_class,
      style = "",
      $$slots,
      $$events,
      ...rest
    } = $$props;
    let node = derived(() => svedit.session.get(path));
    const node_array_meta = getContext("node_array_meta");
    let child_index = derived(() => node_array_meta ? parseInt(String(path.at(-1)), 10) : -1);
    let is_first = derived(() => node_array_meta && child_index() === 0);
    let is_last = derived(() => node_array_meta && child_index() === node_array_meta.length - 1);
    element(
      $$renderer2,
      tag,
      () => {
        $$renderer2.push(`${attributes(
          {
            id: node().id,
            class: `${stringify(css_class)}${stringify(is_first() ? " first" : "")}${stringify(is_last() ? " last" : "")}`,
            "data-node-id": node().id,
            "data-path": path.join("."),
            "data-type": "node",
            style: `anchor-name: --${stringify(path.join("-"))};${stringify(style)}`,
            ...rest
          },
          "svelte-9kabmc"
        )}`);
      },
      () => {
        children($$renderer2);
        $$renderer2.push(`<!---->`);
      }
    );
  });
}
function UnknownNode($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const svedit = getContext("svedit");
    let { path } = $$props;
    let node = derived(() => svedit.session.get(path));
    Node$1($$renderer2, {
      path,
      children: ($$renderer3) => {
        $$renderer3.push(`<!---->Unknown: ${escape_html(node().type)}.`);
      },
      $$slots: { default: true }
    });
  });
}
function NodeGap($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { array_path, offset, count, empty: empty2 = false, positioned = true } = $$props;
    let is_first = derived(() => offset === 0);
    let is_last = derived(() => offset === count);
    let type = derived(() => is_first() ? "gap-before" : "gap-after");
    let gap_style = derived(() => {
      const arr = array_path.join("-");
      const prev_idx = offset - 1;
      const pa = is_first() ? `--${arr}-0` : `--${arr}-${prev_idx}`;
      const next = `--${arr}-${offset}`;
      const container = `--${arr}`;
      return `--_pa:${pa};--_next:${next};--_container:${container}`;
    });
    let anchor_name = derived(() => {
      const arr = array_path.join("-");
      if (is_first()) return `--g-${arr}-0-gap-before`;
      return `--g-${arr}-${offset - 1}-gap-after`;
    });
    $$renderer2.push(`<div${attr_class(`node-gap ${stringify(type())}`, "svelte-12q9zgs", { "empty": empty2, "last": is_last(), "positioned": positioned })}${attr("data-type", type())}${attr("data-gap-array-path", array_path.join("."))}${attr("data-gap-offset", offset)}${attr_style(gap_style())}><div class="svedit-selectable svelte-12q9zgs"${attr_style(`anchor-name:${stringify(anchor_name())}`)}><br/></div></div>`);
  });
}
function NodeCaret($$renderer) {
  $$renderer.push(`<div class="caret svelte-rq8ceb" role="none"></div>`);
}
function NodeGapMarkers($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { path } = $$props;
    const svedit = getContext("svedit");
    let path_str = derived(() => path.join("."));
    let gap_signal = derived(() => svedit.insertion_gap_data?.get_gaps(path_str()));
    let my_gaps = derived(() => gap_signal()?.gaps ?? []);
    let caret_gap_key = derived(() => svedit.insertion_gap_data?.caret_gap_key);
    $$renderer2.push(`<!--[-->`);
    const each_array = ensure_array_like(my_gaps());
    for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
      let gap = each_array[$$index];
      $$renderer2.push(`<div${attr_class(`gap-marker ${stringify(gap.type)}`, "svelte-19buust", {
        "active": gap.key === caret_gap_key(),
        "first": gap.is_first,
        "last": gap.is_last,
        "pair": gap.has_pair
      })}${attr_style(gap.vars)} contenteditable="false">`);
      if (gap.key === caret_gap_key()) {
        $$renderer2.push("<!--[0-->");
        NodeCaret($$renderer2);
      } else {
        $$renderer2.push("<!--[-1-->");
      }
      $$renderer2.push(`<!--]--></div>`);
    }
    $$renderer2.push(`<!--]-->`);
  });
}
function NodeArrayProperty($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const svedit = getContext("svedit");
    let NodeGap$1 = derived(() => svedit.session.config.system_components?.NodeGap ?? NodeGap);
    let NodeGapMarkers$1 = derived(() => svedit.session.config.system_components?.NodeGapMarkers ?? NodeGapMarkers);
    let {
      path,
      tag = "div",
      class: css_class,
      style = "",
      $$slots,
      $$events,
      ...rest
    } = $$props;
    let nodes = derived(() => svedit.session.get(path).map(
      /** @param {string} node_id */
      (node_id) => svedit.session.get(node_id)
    ));
    setContext("node_array_meta", {
      get length() {
        return nodes().length;
      }
    });
    element(
      $$renderer2,
      tag,
      () => {
        $$renderer2.push(`${attributes({
          class: clsx(css_class),
          "data-type": "node_array",
          "data-path": path.join("."),
          style: `anchor-name: --${stringify(path.join("-"))};${stringify(style ? ` ${style}` : "")}`,
          ...rest
        })}`);
      },
      () => {
        if (nodes().length === 0 && svedit.editable) {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<div class="node empty-node-array"${attr("data-path", [...path, 0].join("."))} data-type="node"${attr_style(`anchor-name: --${stringify([...path, 0].join("-"))}; min-height: 40px; min-width: 24px;`)}></div> `);
          if (NodeGap$1()) {
            $$renderer2.push("<!--[-->");
            NodeGap$1()($$renderer2, { array_path: path, offset: 0, count: 0, empty: true });
            $$renderer2.push("<!--]-->");
          } else {
            $$renderer2.push("<!--[!-->");
            $$renderer2.push("<!--]-->");
          }
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> <!--[-->`);
        const each_array = ensure_array_like(nodes());
        for (let index = 0, $$length = each_array.length; index < $$length; index++) {
          let node = each_array[index];
          const Component = svedit.session.config.node_components[snake_to_pascal(node.type)];
          if (svedit.editable) {
            $$renderer2.push("<!--[0-->");
            if (NodeGap$1()) {
              $$renderer2.push("<!--[-->");
              NodeGap$1()($$renderer2, {
                array_path: path,
                offset: index,
                count: nodes().length,
                positioned: svedit.is_near_viewport?.([...path, index]) ?? true
              });
              $$renderer2.push("<!--]-->");
            } else {
              $$renderer2.push("<!--[!-->");
              $$renderer2.push("<!--]-->");
            }
          } else {
            $$renderer2.push("<!--[-1-->");
          }
          $$renderer2.push(`<!--]--> `);
          if (Component) {
            $$renderer2.push("<!--[0-->");
            if (Component) {
              $$renderer2.push("<!--[-->");
              Component($$renderer2, { path: [...path, index] });
              $$renderer2.push("<!--]-->");
            } else {
              $$renderer2.push("<!--[!-->");
              $$renderer2.push("<!--]-->");
            }
          } else {
            $$renderer2.push("<!--[-1-->");
            UnknownNode($$renderer2, { path: [...path, index] });
          }
          $$renderer2.push(`<!--]-->`);
        }
        $$renderer2.push(`<!--]--> `);
        if (svedit.editable && nodes().length > 0) {
          $$renderer2.push("<!--[0-->");
          if (NodeGap$1()) {
            $$renderer2.push("<!--[-->");
            NodeGap$1()($$renderer2, {
              array_path: path,
              offset: nodes().length,
              count: nodes().length,
              positioned: svedit.is_near_viewport?.([...path, nodes().length - 1]) ?? true
            });
            $$renderer2.push("<!--]-->");
          } else {
            $$renderer2.push("<!--[!-->");
            $$renderer2.push("<!--]-->");
          }
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]--> `);
        if (svedit.editable && NodeGapMarkers$1()) {
          $$renderer2.push("<!--[0-->");
          if (NodeGapMarkers$1()) {
            $$renderer2.push("<!--[-->");
            NodeGapMarkers$1()($$renderer2, { path });
            $$renderer2.push("<!--]-->");
          } else {
            $$renderer2.push("<!--[!-->");
            $$renderer2.push("<!--]-->");
          }
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      }
    );
  });
}
function define_document_schema(schema2) {
  return schema2;
}
function is_primitive_type(type) {
  return [
    "string",
    "number",
    "boolean",
    "integer",
    "datetime",
    "annotated_text",
    "string_array",
    "number_array",
    "boolean_array",
    "integer_array"
  ].includes(type);
}
function validate_document_schema(document_schema) {
  for (const [node_type, node_schema] of Object.entries(document_schema)) {
    for (const [prop_name, prop_def] of Object.entries(node_schema.properties)) {
      if (prop_def.type === "node" || prop_def.type === "node_array") {
        const missing_types = prop_def.node_types.filter(
          (ref_type) => !(ref_type in document_schema)
        );
        if (missing_types.length > 0) {
          throw new Error(
            `Node type "${node_type}" property "${prop_name}" references unknown node types: ${missing_types.join(", ")}. Available node types: ${Object.keys(document_schema).join(", ")}`
          );
        }
      }
    }
  }
}
function validate_primitive_value(type, value) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !isNaN(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "datetime":
      return typeof value === "string" && !isNaN(Date.parse(value));
    case "annotated_text":
      return typeof value === "object" && value !== null && typeof value.text === "string" && Array.isArray(value.annotations);
    case "string_array":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "number_array":
      return Array.isArray(value) && value.every((v) => typeof v === "number" && !isNaN(v));
    case "boolean_array":
      return Array.isArray(value) && value.every((v) => typeof v === "boolean");
    case "integer_array":
      return Array.isArray(value) && value.every((v) => Number.isInteger(v));
    default:
      return false;
  }
}
function is_id_valid(id) {
  return typeof id === "string" && id.length > 0;
}
function validate_node(node, schema2, all_nodes = {}) {
  if (!is_id_valid(node.id)) {
    throw new Error(`Node ${node.id} has an invalid id.`);
  }
  if (!node.type || !schema2[node.type]) {
    throw new Error(`Node ${node.id} has an invalid type: ${node.type}`);
  }
  const node_schema = schema2[node.type];
  for (const [prop_name, prop_def] of Object.entries(node_schema.properties)) {
    const value = node[prop_name];
    if (is_primitive_type(prop_def.type)) {
      if (!validate_primitive_value(prop_def.type, value)) {
        throw new Error(
          `Node ${node.id} has an invalid property: ${prop_name} must be of type ${prop_def.type}.`
        );
      }
    }
    if (prop_def.type === "node") {
      if (!is_id_valid(value)) {
        throw new Error(
          `Node ${node.id} has an invalid property: ${prop_name} must be a valid node id.`
        );
      }
      const referenced_node = all_nodes[value];
      if (referenced_node && !prop_def.node_types.includes(referenced_node.type)) {
        throw new Error(
          `Node ${node.id} property ${prop_name} references node ${value} of type ${referenced_node.type}, but only types [${/** @type {NodeProperty} */
          prop_def.node_types.join(", ")}] are allowed.`
        );
      }
    } else if (prop_def.type === "node_array") {
      if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && is_id_valid(id))) {
        throw new Error(
          `Node ${node.id} has an invalid property: ${prop_name} must be an array of node ids.`
        );
      }
      for (const ref_id of value) {
        const referenced_node = all_nodes[ref_id];
        if (referenced_node && !prop_def.node_types.includes(referenced_node.type)) {
          throw new Error(
            `Node ${node.id} property ${prop_name} references node ${ref_id} of type ${referenced_node.type}, but only types [${prop_def.node_types.join(", ")}] are allowed.`
          );
        }
      }
    }
  }
}
function get(schema2, doc, path) {
  if (typeof path === "string") {
    path = [path];
  }
  if (!(Array.isArray(path) && path.length >= 1)) {
    throw new Error(`Invalid path provided ${JSON.stringify(path)}`);
  }
  let val = doc.nodes[path[0]];
  let val_type = "node";
  for (let i = 1; i < path.length; i++) {
    const path_segment = path[i];
    const path_segment_str = String(path_segment);
    if (val_type === "node") {
      if (property_type(schema2, val.type, path_segment_str) === "node_array") {
        val = val[path_segment];
        val_type = "node_array";
      } else if (property_type(schema2, val.type, path_segment_str) === "annotated_text") {
        val = val[path_segment];
        val_type = "annotated_text";
      } else if (property_type(schema2, val.type, path_segment_str) === "node") {
        val = doc.nodes[val[path_segment]];
        val_type = "node";
      } else if (["string_array", "integer_array"].includes(
        property_type(schema2, val.type, path_segment_str)
      )) {
        val = val[path_segment];
        val_type = "value_array";
      } else {
        val = val[path_segment];
        val_type = "value";
      }
    } else if (val_type === "node_array") {
      val = doc.nodes[val[path_segment]];
      val_type = "node";
    } else if (val_type === "value_array") {
      val = val[path_segment];
      val_type = "value";
    } else if (val_type === "annotated_text") {
      if (path_segment === "text") {
        val = val.text;
        val_type = "value";
      } else if (path_segment === "annotations") {
        val = val.annotations;
        val_type = "annotation_array";
      } else {
        throw new Error(
          `Invalid path segment "${path_segment}" for annotated_text. Use "text" or "annotations".`
        );
      }
    } else if (val_type === "annotation_array") {
      val = val[path_segment];
      val_type = "annotation";
    } else if (val_type === "annotation") {
      if (path_segment === "node_id") {
        val = doc.nodes[val.node_id];
        val_type = "node";
      } else if (path_segment === "start_offset") {
        val = val.start_offset;
        val_type = "value";
      } else if (path_segment === "end_offset") {
        val = val.end_offset;
        val_type = "value";
      } else {
        throw new Error(
          `Invalid path segment "${path_segment}" for annotation. Use "start_offset", "end_offset", or "node_id".`
        );
      }
    }
  }
  return val;
}
function property_type(schema2, type, property) {
  if (typeof type !== "string") throw new Error(`Invalid type ${type} provided`);
  if (typeof property !== "string") throw new Error(`Invalid property ${property} provided`);
  if (property === "type") return "string";
  if (property === "id") return "string";
  if (!schema2[type]) throw new Error(`Type ${type} not found in schema`);
  if (!schema2[type].properties[property])
    throw new Error(`Property ${property} not found in type ${type}`);
  return schema2[type].properties[property].type;
}
function kind(schema2, node) {
  return schema2[node.type].kind;
}
function inspect(schema2, doc, path) {
  const parent = path.length > 1 ? get(schema2, doc, path.slice(0, -1)) : void 0;
  if (parent?.type) {
    const property_name = path.at(-1);
    return {
      kind: "property",
      name: property_name,
      ...schema2[parent.type].properties[property_name]
    };
  } else {
    const node = get(schema2, doc, path);
    return {
      kind: "node",
      id: node.id,
      type: node.type,
      properties: schema2[node.type]
    };
  }
}
function apply_op(doc, op) {
  const [type, ...args] = op;
  if (type === "set") {
    const [node_id, property] = args[0];
    const value = structuredClone(args[1]);
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [node_id]: {
          ...doc.nodes[node_id],
          [property]: value
        }
      }
    };
  } else if (type === "create") {
    return {
      ...doc,
      nodes: {
        ...doc.nodes,
        [args[0].id]: structuredClone(args[0])
      }
    };
  } else if (type === "delete") {
    const { [args[0]]: _removed, ...remaining_nodes } = doc.nodes;
    return {
      ...doc,
      nodes: remaining_nodes
    };
  }
  return doc;
}
function count_references(schema2, doc, node_id) {
  let count = 0;
  for (const node of Object.values(doc.nodes)) {
    for (const [property, value] of Object.entries(node)) {
      if (property === "id" || property === "type") continue;
      const prop_type = property_type(schema2, node.type, property);
      if (prop_type === "node_array" && Array.isArray(value)) {
        count += value.filter((id) => id === node_id).length;
      } else if (prop_type === "node" && value === node_id) {
        count += 1;
      }
    }
  }
  return count;
}
function get_active_annotation(schema2, doc, selection, annotation_type) {
  if (selection?.type !== "text") return null;
  const range = get_selection_range(selection);
  if (!range) return null;
  const annotated_text = get(schema2, doc, selection.path);
  const annotations = annotated_text.annotations;
  const active_annotation = annotations.find(
    ({ start_offset, end_offset }) => start_offset <= range.start_offset && end_offset > range.start_offset || start_offset < range.end_offset && end_offset >= range.end_offset || start_offset >= range.start_offset && end_offset <= range.end_offset
  ) || null;
  if (annotation_type && active_annotation) {
    const annotation_node = get(schema2, doc, [active_annotation.node_id]);
    return annotation_node?.type === annotation_type ? active_annotation : null;
  } else {
    return active_annotation;
  }
}
function count_references_excluding_deleted(schema2, doc, target_node_id, nodes_to_delete) {
  let count = 0;
  for (const node of Object.values(doc.nodes)) {
    if (nodes_to_delete[node.id]) continue;
    for (const [property, value] of Object.entries(node)) {
      if (property === "id" || property === "type") continue;
      const prop_type = property_type(schema2, node.type, property);
      if (prop_type === "node_array" && Array.isArray(value)) {
        count += value.filter((id) => id === target_node_id).length;
      } else if (prop_type === "node" && value === target_node_id) {
        count += 1;
      } else if (prop_type === "annotated_text" && value && value.annotations) {
        count += value.annotations.filter(
          (annotation) => annotation.node_id === target_node_id
        ).length;
      }
    }
  }
  return count;
}
function validate_selection(selection, session_or_transaction) {
  if (!selection) return;
  const selection_type = selection.type;
  if (!["node", "text", "property"].includes(selection_type)) {
    throw new Error(`Invalid selection type: ${selection_type}`);
  }
  if (selection_type === "node") {
    const node_array = session_or_transaction.get(selection.path);
    if (!Array.isArray(node_array)) {
      throw new Error("Node selection path must point to a node_array");
    }
    const max_offset = node_array.length;
    if (selection.anchor_offset < 0 || selection.anchor_offset > max_offset) {
      throw new Error(
        `Node selection anchor_offset (${selection.anchor_offset}) is out of bounds. Max is ${max_offset}.`
      );
    }
    if (selection.focus_offset < 0 || selection.focus_offset > max_offset) {
      throw new Error(
        `Node selection focus_offset (${selection.focus_offset}) is out of bounds. Max is ${max_offset}.`
      );
    }
  } else if (selection_type === "text") {
    const annotated_text = session_or_transaction.get(selection.path);
    if (!annotated_text || typeof annotated_text.text !== "string") {
      throw new Error("Text selection path must point to annotated_text");
    }
    const char_length = get_char_length(annotated_text.text);
    if (selection.anchor_offset < 0 || selection.anchor_offset > char_length) {
      throw new Error(
        `Text selection anchor_offset (${selection.anchor_offset}) is out of bounds. Max is ${char_length}.`
      );
    }
    if (selection.focus_offset < 0 || selection.focus_offset > char_length) {
      throw new Error(
        `Text selection focus_offset (${selection.focus_offset}) is out of bounds. Max is ${char_length}.`
      );
    }
  } else if (selection_type === "property") {
    if (!session_or_transaction.inspect(selection.path)) {
      throw new Error(`Property selection path not found: ${selection.path.join(".")}`);
    }
  }
}
function join_text_node(tr) {
  const selection = tr.selection;
  if (selection.type !== "text") return false;
  const node = tr.get(selection.path.slice(0, -1));
  if (tr.kind(node) !== "text") return false;
  const is_inside_node_array = tr.inspect(selection.path.slice(0, -2))?.type === "node_array";
  if (!is_inside_node_array) return false;
  const node_index = parseInt(tr.selection.path.at(-2), 10);
  let can_join = false;
  let predecessor_node = null;
  if (node_index > 0) {
    const previous_text_path2 = [...tr.selection.path.slice(0, -2), node_index - 1];
    predecessor_node = tr.get(previous_text_path2);
    can_join = tr.kind(predecessor_node) === "text";
  }
  if (!can_join && node.content.text === "") {
    tr.set_selection({
      type: "node",
      path: tr.selection.path.slice(0, -2),
      anchor_offset: node_index,
      focus_offset: node_index + 1
    });
    tr.delete_selection();
    return true;
  }
  if (!can_join) {
    return false;
  }
  const previous_text_path = [...tr.selection.path.slice(0, -2), node_index - 1];
  const joined_text = join_annotated_text(predecessor_node.content, node.content);
  const caret_position = get_char_length(predecessor_node.content.text);
  tr.set([predecessor_node.id, "content"], joined_text);
  tr.set_selection({
    type: "node",
    path: tr.selection.path.slice(0, -2),
    anchor_offset: node_index,
    focus_offset: node_index + 1
  });
  tr.delete_selection();
  tr.set_selection({
    type: "text",
    path: [...previous_text_path, "content"],
    anchor_offset: caret_position,
    focus_offset: caret_position
  });
  return true;
}
class Transaction {
  /**
   * Creates a new Transaction with the given state.
   *
   * @param {DocumentSchema} schema - The document schema
   * @param {Document} doc - The document state {document_id, nodes}
   * @param {Selection | null} selection - The current selection
   * @param {object} config - The document config (including generate_id)
   */
  constructor(schema2, doc, selection, config2) {
    this.schema = schema2;
    this.doc = doc;
    this.selection = selection;
    this.config = config2;
    this.ops = [];
    this.inverse_ops = [];
    this.selection_before = selection;
  }
  /**
   * Gets a value from the document at the specified path.
   *
   * @param {DocumentPath|string} path - The path to the value in the document, or a string node ID
   * @returns {any} The value at the specified path
   */
  get(path) {
    return get(this.schema, this.doc, path);
  }
  /**
   * Gets the type of a property from the schema.
   *
   * @param {string} type - The node type
   * @param {string} property - The property name
   * @returns {string} The property type
   */
  property_type(type, property) {
    return property_type(this.schema, type, property);
  }
  /**
   * Determines the kind of a node ('block', 'text', or 'annotation').
   *
   * @param {any} node - The node to check
   * @returns {'block'|'text'|'annotation'} The node kind
   */
  kind(node) {
    return kind(this.schema, node);
  }
  /**
   * Inspects a path to get metadata about the value at that location.
   *
   * @param {DocumentPath} path - The path to inspect
   * @returns {{kind: 'property'|'node', [key: string]: any}} Metadata about the path
   */
  inspect(path) {
    return inspect(this.schema, this.doc, path);
  }
  /**
   * Generates a new unique ID using the config's generate_id function.
   *
   * @returns {string} A new unique ID
   */
  generate_id() {
    return this.config.generate_id();
  }
  /**
   * Validates a node against the document schema.
   *
   * @param {any} node - The node to validate
   * @throws {Error} Throws if the node is invalid
   */
  validate_node(node) {
    validate_node(node, this.schema, this.doc.nodes);
  }
  /**
   * Gets all nodes referenced by a given node (recursively).
   *
   * @param {NodeId} node_id - The node ID to get references for
   * @returns {NodeId[]} Array of referenced node IDs
   */
  get_referenced_nodes(node_id) {
    const traversed_nodes = traverse(node_id, this.schema, this.doc.nodes);
    return traversed_nodes.slice(0, -1).map((node) => node.id);
  }
  /**
   * Gets the available annotation types for the current selection.
   *
   * @returns {string[]} Array of available annotation type names
   */
  get available_annotation_types() {
    if (this.selection?.type !== "text") return [];
    const path = this.selection.path;
    const property_definition = this.inspect(path);
    return property_definition.node_types || [];
  }
  /**
   * Returns the annotation object that is currently "under the caret".
   * NOTE: Annotations in Svedit are exclusive, so there can only be one active_annotation
   *
   * @param {string} [annotation_type] Optional annotation type to filter by
   * @returns {Annotation|null}
   */
  active_annotation(annotation_type) {
    return get_active_annotation(this.schema, this.doc, this.selection, annotation_type);
  }
  /**
   * Applies an operation to the document (internal).
   *
   * @param {Array} op - The operation to apply
   * @private
   */
  _apply_op(op) {
    this.doc = apply_op(this.doc, op);
  }
  /**
   * Sets a property of a node to a new value.
   *
   * This is the core operation for modifying document properties. It records
   * both the forward operation and its inverse for undo support.
   *
   * @param {DocumentPath} path - Array path to the property (e.g., ["node_1", "title"])
   * @param {any} value - The new value to set
   * @returns {Transaction} This transaction instance for method chaining
   *
   * @example
   * ```js
   * tr.set(["list_1", "list_items"], [1, 2, 3]);
   * tr.set(["page_1", "body", "0", "description"], {text: "Hello world", annotations: []});
   * ```
   */
  set(path, value) {
    const node = this.get(path.slice(0, -1));
    const normalized_path = [node.id, path.at(-1)];
    const property_key = path.at(-1);
    if (property_key === void 0) {
      throw new Error("Invalid path: cannot get property key");
    }
    const property_key_str = String(property_key);
    const previous_value = structuredClone(snapshot(node[property_key_str]));
    const prop_type = this.property_type(node.type, property_key_str);
    let removed_node_ids = [];
    if (prop_type === "node" && typeof previous_value === "string" && previous_value !== value) {
      removed_node_ids = [previous_value];
    } else if (prop_type === "node_array" && Array.isArray(previous_value) && Array.isArray(value)) {
      removed_node_ids = previous_value.filter((id) => !value.includes(id));
    }
    const op = ["set", normalized_path, value];
    this.ops.push(op);
    this.inverse_ops.push(["set", normalized_path, previous_value]);
    this._apply_op(op);
    for (const removed_node_id of removed_node_ids) {
      this.delete(removed_node_id);
    }
    return this;
  }
  // Takes a subgraph and constructs new nodes from it
  // NOTE: all ids will be mapped to new unique ids.
  // NOTE: Omitted properties will be populated with default values.
  build(node_id, nodes) {
    const depth_first_nodes = traverse(node_id, this.schema, nodes);
    const id_map = {};
    for (const node of depth_first_nodes) {
      const new_id = this.generate_id();
      id_map[node.id] = new_id;
      const new_node = { ...node, id: new_id };
      const node_schema = this.schema[node.type];
      for (const [property_name, property_definition] of Object.entries(node_schema.properties)) {
        const prop_type = property_definition.type;
        const value = node[property_name];
        if (prop_type === "node_array") {
          new_node[property_name] = Array.isArray(value) ? value.map((ref_id) => id_map[ref_id]) : [];
        } else if (prop_type === "node") {
          new_node[property_name] = typeof value === "string" ? id_map[value] : null;
        } else if (prop_type === "annotated_text") {
          if (value) {
            const annotations = value.annotations.map((annotation) => {
              const { start_offset, end_offset, node_id: node_id2 } = annotation;
              return {
                start_offset,
                end_offset,
                node_id: id_map[node_id2] || node_id2
              };
            });
            new_node[property_name] = { text: value.text, annotations };
          } else {
            new_node[property_name] = { text: "", annotations: [] };
          }
        } else if (prop_type === "string") {
          new_node[property_name] = value ?? property_definition.default ?? "";
        } else if (prop_type === "integer") {
          new_node[property_name] = value ?? property_definition.default ?? 0;
        } else if (prop_type === "number") {
          new_node[property_name] = value ?? property_definition.default ?? 0;
        } else if (prop_type === "boolean") {
          new_node[property_name] = value ?? property_definition.default ?? false;
        } else if (["integer_array", "number_array"].includes(prop_type)) {
          new_node[property_name] = value ?? property_definition.default ?? [];
        } else if (prop_type === "string_array") {
          new_node[property_name] = value ?? property_definition.default ?? [];
        }
      }
      this.create(new_node);
    }
    return id_map[depth_first_nodes.at(-1).id];
  }
  /**
   * Creates a new node in the document.
   *
   * The node must have a valid id and must not already exist in the document.
   * The node is validated against the document schema before creation.
   *
   * @param {any} node - The node object to create (must include id, type, and other properties)
   * @returns {Transaction} This transaction instance for method chaining
   * @throws {Error} If the node ID is invalid or if the node already exists
   *
   * @example
   * ```js
   * tr.create({
   *   id: 'para_123',
   *   type: 'paragraph',
   *   content: ['Hello world', []]
   * });
   * ```
   */
  create(node) {
    this.validate_node(node);
    if (this.get(node.id)) {
      throw new Error("Node with id " + node.id + " already exists");
    }
    const op = ["create", node];
    this.ops.push(op);
    this.inverse_ops.push(["delete", node.id]);
    this._apply_op(op);
    return this;
  }
  /**
   * Deletes a node from the document by its ID.
   *
   * The node's current state is captured for undo support before deletion.
   *
   * @param {any} id - The ID of the node to delete
   * @returns {Transaction} This transaction instance for method chaining
   *
   * @example
   * ```js
   * tr.delete('node_123');
   * ```
   */
  delete(id) {
    const previous_value = this.get(id);
    if (!previous_value) {
      console.warn(`Deletion of node ${id} skipped, as it does not exist.`);
      return this;
    }
    const referenced_nodes = this.get_referenced_nodes(id);
    const op = ["delete", id];
    this.ops.push(op);
    this.inverse_ops.push(["create", previous_value]);
    this._apply_op(op);
    this._cascade_delete_unreferenced_nodes(referenced_nodes);
    return this;
  }
  /**
   * Sets the document selection.
   *
   * @param {Selection} selection - The new selection object
   * @returns {Transaction} This transaction instance for method chaining
   * @throws {Error} Throws if the selection is invalid or out of bounds
   */
  set_selection(selection) {
    this._validate_selection(selection);
    this.selection = selection;
    return this;
  }
  /**
   * Validates a selection against the current document state.
   *
   * @param {Selection} selection - The selection to validate
   * @throws {Error} Throws if the selection is invalid
   * @private
   */
  _validate_selection(selection) {
    validate_selection(selection, this);
  }
  /**
   * Adds, updates, or removes text annotations in the current selection.
   *
   * Handles various annotation scenarios including adding new annotations,
   * updating existing ones (especially for links), and removing annotations
   * when conflicting types are applied.
   *
   * @param {any} annotation_type - The type of annotation (e.g., 'link', 'bold', 'italic')
   * @param {any} annotation_properties - Additional data for the annotation (e.g., href for links)
   * @returns {Transaction} This transaction instance for method chaining
   *
   * @example
   * ```js
   * // Add a link annotation
   * tr.annotate_text('link', { href: 'https://example.com' });
   *
   * // Add emphasis
   * tr.annotate_text('emphasis', {});
   * ```
   */
  annotate_text(annotation_type, annotation_properties) {
    if (this.selection.type !== "text") return this;
    const range = get_selection_range(this.selection);
    const annotated_text = structuredClone(snapshot(this.get(this.selection.path)));
    const annotations = annotated_text.annotations;
    const existing_annotation = this.active_annotation();
    const existing_annotation_same_type = this.active_annotation(annotation_type);
    if (existing_annotation) {
      if (existing_annotation_same_type) {
        const index = annotations.findIndex(
          /** @param {any} anno */
          (anno) => anno.start_offset === existing_annotation.start_offset && anno.end_offset === existing_annotation.end_offset
        );
        if (index !== -1) {
          this.delete(annotations[index].node_id);
          annotations.splice(index, 1);
        }
      } else {
        return this;
      }
    } else {
      if (is_selection_collapsed(this.selection)) {
        console.log("Annotations can only be added to expanded text selections.");
        return this;
      }
      if (!this.available_annotation_types.includes(annotation_type)) {
        console.log(`Annotation type ${annotation_type} is not allowed here.`);
        return this;
      }
      const new_annotation_node = {
        id: this.generate_id(),
        type: annotation_type,
        ...annotation_properties
      };
      this.create(new_annotation_node);
      annotations.push({
        start_offset: range.start_offset,
        end_offset: range.end_offset,
        node_id: new_annotation_node.id
      });
    }
    this.set(this.selection.path, annotated_text);
    return this;
  }
  /**
   * Deletes the currently selected text or nodes.
   *
   * Behavior depends on selection type:
   * - For node selections: Removes selected nodes and cascades deletion of unreferenced nodes
   * - For text selections: Removes selected text and adjusts annotations accordingly
   * - For collapsed selections: Deletes the previous character/node (backward) or next character/node (forward)
   * - Property selections are ignored: Those are best handled handled via commands + keyboard shortcuts.
   *
   * @param {'backward' | 'forward'} [direction] - Direction of deletion for collapsed selections
   * @returns {Transaction} This transaction instance for method chaining
   */
  delete_selection(direction = "backward") {
    if (!this.selection || this.selection.type === "property") return this;
    const path = this.selection.path;
    let start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
    let end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
    let length;
    if (this.selection?.type === "text") {
      const text_content = this.get(this.selection.path).text;
      length = get_char_length(text_content);
    } else if (this.selection?.type === "node") {
      const node_array = this.get(this.selection.path);
      length = node_array.length;
    }
    if (start === end) {
      if (direction === "backward" && start > 0) {
        start = start - 1;
      } else if (direction === "forward" && end < length) {
        end = end + 1;
      } else if (direction === "backward" && start === 0) {
        join_text_node(this);
        return this;
      } else if (direction === "forward" && end === length) {
        const node_index = parseInt(String(this.selection.path.at(-2)), 10);
        const successor_node = this.get([...this.selection.path.slice(0, -2), node_index + 1]);
        if (successor_node && this.kind(successor_node) === "text") {
          this.set_selection({
            type: "text",
            path: [
              ...this.selection.path.slice(0, -2),
              node_index + 1,
              "content"
            ],
            anchor_offset: 0,
            focus_offset: 0
          });
          join_text_node(this);
        }
        return this;
      }
    }
    if (this.selection.type === "node") {
      const node_array = [...this.get(path)];
      node_array.splice(start, end - start);
      this.set(path, node_array);
      this.selection = {
        type: "node",
        path,
        anchor_offset: start,
        focus_offset: start
      };
    } else if (this.selection.type === "text") {
      const path2 = this.selection.path;
      let text = structuredClone(snapshot(this.get(path2)));
      const original_text = text.text;
      text.text = char_slice(original_text, 0, start) + char_slice(original_text, end, get_char_length(original_text));
      const _deleted_nodes = [];
      const deletion_length = end - start;
      const new_annotations = text.annotations.map((annotation) => {
        const annotation_start = annotation.start_offset;
        const annotation_end = annotation.end_offset;
        const node_id = annotation.node_id;
        if (annotation_end <= start) {
          return annotation;
        }
        let new_start = annotation_start;
        if (annotation_start >= end) {
          new_start = annotation_start - deletion_length;
        } else if (annotation_start > start) {
          new_start = start;
        }
        let new_end = annotation_end;
        if (annotation_end >= end) {
          new_end = annotation_end - deletion_length;
        } else if (annotation_end > start) {
          new_end = start;
        }
        if (new_start >= new_end) {
          _deleted_nodes.push(node_id);
          return null;
        }
        return { start_offset: new_start, end_offset: new_end, node_id };
      }).filter(Boolean);
      text.annotations = new_annotations;
      for (const node_id of _deleted_nodes) {
        this.delete(node_id);
      }
      this.set(path2, text);
      this.selection = {
        type: "text",
        path: path2,
        anchor_offset: start,
        focus_offset: start
      };
    }
    return this;
  }
  /**
   * Inserts nodes at the current node selection position.
   *
   * If the selection is expanded (not collapsed), first deletes the selected nodes
   * before inserting the new ones.
   *
   * @param {NodeId[]} node_ids - Array of node IDs to insert
   * @returns {Transaction} This transaction instance for method chaining
   */
  insert_nodes(node_ids) {
    if (this.selection.type !== "node") return this;
    if (this.selection.anchor_offset !== this.selection.focus_offset) {
      this.delete_selection();
    }
    const path = this.selection.path;
    const node_array = [...this.get(path)];
    let start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
    node_array.splice(start, 0, ...node_ids);
    this.set(path, node_array);
    this.selection = {
      type: "node",
      path: [...this.selection.path],
      anchor_offset: start,
      focus_offset: start + node_ids.length
    };
    return this;
  }
  /**
   * Inserts text at the current text selection position.
   *
   * Handles annotation adjustments when text is inserted, including:
   * - Expanding annotations that contain the insertion point
   * - Shifting annotations that come after the insertion point
   * - Optionally applying new annotations to the inserted text
   *
   * @param {string} replaced_text - The text to insert
   * @param {Array} [annotations] - Optional annotations to apply to the inserted text
   * @param {object} [nodes] - Optional node definitions for annotation nodes
   * @returns {Transaction} This transaction instance for method chaining
   */
  insert_text(replaced_text, annotations = [], nodes = {}) {
    if (this.selection?.type !== "text") return this;
    if (!is_selection_collapsed(this.selection)) {
      this.delete_selection();
    }
    const annotated_text = structuredClone(snapshot(this.get(this.selection.path)));
    const range = get_selection_range(this.selection);
    const text = annotated_text.text;
    annotated_text.text = char_slice(text, 0, range.start_offset) + replaced_text + char_slice(text, range.end_offset);
    const delta = get_char_length(replaced_text);
    const new_annotations = annotated_text.annotations.map((annotation) => {
      const annotation_start = annotation.start_offset;
      const annotation_end = annotation.end_offset;
      const node_id = annotation.node_id;
      if (annotation_end <= range.start_offset) {
        return annotation;
      }
      if (annotation_start < range.start_offset && annotation_end >= range.start_offset) {
        return {
          start_offset: annotation_start,
          end_offset: annotation_end + delta,
          node_id
        };
      }
      if (annotation_start >= range.start_offset) {
        return {
          start_offset: annotation_start + delta,
          end_offset: annotation_end + delta,
          node_id
        };
      }
      return annotation;
    });
    annotated_text.annotations = new_annotations;
    this.set(this.selection.path, annotated_text);
    const new_selection = {
      type: (
        /** @type {const} */
        "text"
      ),
      path: this.selection.path,
      anchor_offset: range.start_offset + get_char_length(replaced_text),
      focus_offset: range.start_offset + get_char_length(replaced_text)
    };
    this.selection = new_selection;
    if (!this.active_annotation() && annotations.length > 0) {
      const new_annotations2 = annotations.map((annotation) => {
        const original_annotation_node = nodes[annotation.node_id];
        const text_property_definition = this.inspect(this.selection.path);
        if (text_property_definition.node_types.includes(original_annotation_node.type)) {
          const new_annotation_node_id = this.build(annotation.node_id, nodes);
          return {
            start_offset: range.start_offset + annotation.start_offset,
            end_offset: range.start_offset + annotation.end_offset,
            node_id: new_annotation_node_id
          };
        }
        return null;
      }).filter(Boolean);
      const next_annotated_text = structuredClone(annotated_text);
      next_annotated_text.annotations = next_annotated_text.annotations.concat(new_annotations2);
      this.set(this.selection.path, next_annotated_text);
    }
    return this;
  }
  /**
   * Recursively deletes nodes that are no longer referenced in the document.
   *
   * This handles the cascade deletion of child nodes when their parent
   * references are removed. Uses reference counting to determine which
   * nodes are safe to delete.
   *
   * @param {NodeId[]} potentially_orphaned_nodes - Array of node IDs to check
   * @private
   */
  _cascade_delete_unreferenced_nodes(potentially_orphaned_nodes) {
    const nodes_to_delete = {};
    const to_check = [...potentially_orphaned_nodes];
    while (to_check.length > 0) {
      const node_id = to_check.pop();
      if (!node_id || nodes_to_delete[node_id]) continue;
      const ref_count = this._count_references_excluding_deleted(node_id, nodes_to_delete);
      if (ref_count === 0) {
        nodes_to_delete[node_id] = true;
        const referenced_nodes = this.get_referenced_nodes(node_id);
        to_check.push(...referenced_nodes);
      }
    }
    for (const node_id of Object.keys(nodes_to_delete)) {
      const previous_value = this.get([node_id]);
      if (previous_value) {
        const op = ["delete", node_id];
        this.ops.push(op);
        this.inverse_ops.push(["create", previous_value]);
        this._apply_op(op);
      }
    }
  }
  /**
   * Counts references to a node, excluding nodes that have been marked for deletion.
   *
   * This is used during cascade deletion to accurately count remaining references
   * as nodes are being deleted.
   *
   * @param {NodeId} target_node_id - The node ID to count references for
   * @param {Record<NodeId, boolean>} nodes_to_delete - Nodes already marked for deletion
   * @returns {number} The number of references to the target node
   * @private
   */
  _count_references_excluding_deleted(target_node_id, nodes_to_delete) {
    return count_references_excluding_deleted(this.schema, this.doc, target_node_id, nodes_to_delete);
  }
}
const BATCH_WINDOW_MS = 1e3;
class Session {
  /** @type {Selection | null} */
  #selection = null;
  /** @type {DocumentSchema} */
  schema;
  /** @type {Document} */
  doc;
  /** @type {any} */
  config;
  history = [];
  history_index = -1;
  last_batch_started = void 0;
  // Timestamp for debounced batching
  // Commands and keymap - initialized by Svedit when ready
  // NOTE: Assumes single Svedit instance per session
  commands = {};
  keymap = {};
  #can_undo = derived(() => this.history_index >= 0);
  get can_undo() {
    return this.#can_undo();
  }
  set can_undo($$value) {
    return this.#can_undo($$value);
  }
  #can_redo = derived(() => this.history_index < this.history.length - 1);
  get can_redo() {
    return this.#can_redo();
  }
  set can_redo($$value) {
    return this.#can_redo($$value);
  }
  #selected_node = derived(() => this.get_selected_node());
  get selected_node() {
    return this.#selected_node();
  }
  set selected_node($$value) {
    return this.#selected_node($$value);
  }
  #available_annotation_types = derived(() => this.get_available_annotation_types());
  get available_annotation_types() {
    return this.#available_annotation_types();
  }
  set available_annotation_types($$value) {
    return this.#available_annotation_types($$value);
  }
  constructor(schema2, doc, config2, options = {}) {
    validate_document_schema(schema2);
    this.schema = schema2;
    this.doc = doc;
    this.config = config2;
    this.selection = options.selection ?? null;
  }
  /**
   * Gets the current selection
   * @returns {Selection | null}
   */
  get selection() {
    return this.#selection;
  }
  /**
   * Sets the selection with validation
   * @param {Selection | null} value - The new selection
   * @throws {Error} Throws if the selection is invalid
   */
  set selection(value) {
    this._validate_selection(value);
    this.#selection = value;
  }
  /**
   * Validates that a selection is within bounds and refers to valid paths.
   *
   * @param {Selection} selection - The selection to validate
   * @throws {Error} Throws if the selection is invalid
   * @private
   */
  _validate_selection(selection) {
    validate_selection(selection, this);
  }
  /**
   * Gets the document_id from the doc
   * @returns {string}
   */
  get document_id() {
    return this.doc.document_id;
  }
  validate_doc() {
    for (const node of Object.values(this.doc.nodes)) {
      validate_node(node, this.schema, this.doc.nodes);
    }
  }
  generate_id() {
    if (this.config?.generate_id) {
      return this.config.generate_id();
    } else {
      return crypto.randomUUID();
    }
  }
  /**
   * Initialize commands and keymap for this session.
   * Called by Svedit component when it has the necessary context.
   *
   * NOTE: This assumes a single Svedit instance per session.
   * For multiple editors on the same document, this architecture would need
   * to be refactored to support multiple sessions per document.
   *
   * @param {object} context - The svedit context with session, editable, canvas, etc.
   */
  initialize_commands(context) {
    if (this.config?.create_commands_and_keymap) {
      const { commands, keymap } = this.config.create_commands_and_keymap(context);
      this.commands = commands;
      this.keymap = keymap;
    }
  }
  get_available_annotation_types() {
    if (this.selection?.type !== "text") return [];
    const path = this.selection.path;
    const property_definition = this.inspect(path);
    return property_definition.node_types || [];
  }
  // Helper function to get the currently selected node
  get_selected_node() {
    if (!this.selection) return null;
    if (this.selection.type === "node") {
      const start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
      const end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
      if (end - start !== 1) return null;
      const node_array = this.get(this.selection.path);
      const node_id = node_array[start];
      return node_id ? this.get(node_id) : null;
    } else {
      const owner_node_path = this.selection?.path?.slice(0, -1);
      if (!owner_node_path) return null;
      const owner_node = this.get(owner_node_path);
      return owner_node;
    }
  }
  /**
   * Creates a new transaction for making atomic changes to the document.
   *
   * @returns {Transaction} A new transaction instance
   */
  get tr() {
    return new Transaction(this.schema, this.doc, this.selection, this.config);
  }
  /**
   * Applies a transaction to the document.
   * Auto-batches history entries with debounced behavior (max one entry per 2 seconds) when batch is true.
   *
   * @param {Transaction} transaction - The transaction to apply
   * @param {object} [options] - Optional configuration
   * @param {boolean} [options.batch=false] - Whether to allow batching with previous transaction
   */
  apply(transaction, { batch = false } = {}) {
    this.doc = transaction.doc;
    this.selection = structuredClone(transaction.selection);
    if (this.history_index < this.history.length - 1) {
      this.history = this.history.slice(0, this.history_index + 1);
    }
    const now = Date.now();
    const should_batch = batch && this.last_batch_started !== void 0 && now - this.last_batch_started < BATCH_WINDOW_MS;
    if (should_batch) {
      const last_entry = this.history[this.history_index];
      last_entry.ops.push(...transaction.ops);
      last_entry.inverse_ops.push(...transaction.inverse_ops);
      last_entry.selection_after = this.selection;
      this.history = [...this.history];
    } else {
      this.history = [
        ...this.history,
        {
          ops: transaction.ops,
          inverse_ops: transaction.inverse_ops,
          selection_before: transaction.selection_before,
          selection_after: this.selection
        }
      ];
      this.history_index = this.history_index + 1;
      if (batch) {
        this.last_batch_started = now;
      } else {
        this.last_batch_started = void 0;
      }
    }
    return this;
  }
  undo() {
    if (this.history_index < 0) {
      return;
    }
    const change = this.history[this.history_index];
    let doc = this.doc;
    change.inverse_ops.slice().reverse().forEach((op) => {
      doc = apply_op(doc, op);
    });
    this.doc = doc;
    this.selection = change.selection_before;
    this.history_index = this.history_index - 1;
    return this;
  }
  redo() {
    if (this.history_index >= this.history.length - 1) {
      return;
    }
    this.history_index = this.history_index + 1;
    const change = this.history[this.history_index];
    let doc = this.doc;
    change.ops.forEach((op) => {
      doc = apply_op(doc, op);
    });
    this.doc = doc;
    this.selection = change.selection_after;
    return this;
  }
  /**
   * Gets a node instance or property value at the specified path.
   * @param {DocumentPath|string} path - Path to the node or property
   * @returns {any} Either a node instance object or the value of a property
   * @example
   * // Get a node by ID
   * session.get('list_1') // => { type: 'list', id: 'list_1', ... }
   *
   * @example
   * // Get a node array property
   * session.get(['list_1', 'list_items']) // => [ 'list_item_1', 'list_item_2' ]
   *
   * @example
   * // Get a specific node from an array
   * session.get(['page_1', 'body', 3, 'list_items', 0]) // => { type: 'list_item', id: 'list_item_1', ... }
   *
   * @example
   * // Get an annotated text property
   * session.get(['page_1', 'cover', 'title']) // => {text: 'Hello world', annotations: []}
   */
  get(path) {
    return get(this.schema, this.doc, path);
  }
  /**
   * While .get gives you the value of a path, inspect gives you
   * the type info of that value.
   *
   * @todo The layout of these should be improved and more explictly typed
   *
   * @example
   * session.inspect(['page_1', 'body']) => {
   *   kind: 'property',
   *   name: 'body',
   *   type: 'node_array',
   *   node_types: ['text', 'story', 'list'],
   *   default_node_type: 'text'
   * }
   *
   * @example
   * session.inspect(['page_1', 'body', 1]) => {
   *   kind: 'node',
   *   id: 'paragraph_234',
   *   type: 'paragraph',
   *   properties: {...}
   * }
   *
   * @param {DocumentPath} path
   * @returns {{kind: 'property'|'node', [key: string]: any}}
   */
  inspect(path) {
    return inspect(this.schema, this.doc, path);
  }
  /**
   * Determines the kind of a node ('block' for structured blocks, 'text' for pure
   * text nodes or 'annotation' for annotation nodes.
   * @param {any} node
   * @returns {NodeKind}
   */
  kind(node) {
    return kind(this.schema, node);
  }
  /**
   * Determines whether a node type can be inserted at a given selection.
   * @param {string} node_type - The type of node to insert.
   * @param {Selection} [selection] - The selection at which to insert the node.
   * @returns {boolean} True if the node type can be inserted, false otherwise.
   */
  can_insert(node_type, selection = this.selection) {
    if (selection?.type === "node") {
      const property_definition = this.inspect(selection.path);
      if (property_definition.node_types.includes(node_type)) {
        return true;
      }
    }
    let next_node_insert_caret = this.get_next_node_insert_caret(selection);
    if (!next_node_insert_caret) return false;
    return this.can_insert(node_type, next_node_insert_caret);
  }
  /**
   * Compute next possible insert position from a given selection
   *
   * @param {Selection} [selection] - Reference selection
   * @returns {Selection|null} The next node insert caret selection, or null if none is available
   */
  get_next_node_insert_caret(selection = this.selection) {
    if (!selection || selection.path.length <= 2) {
      return null;
    }
    const node_offset = parseInt(String(selection.path.at(-2)), 10) + 1;
    return {
      type: "node",
      path: selection.path.slice(0, -2),
      anchor_offset: node_offset,
      focus_offset: node_offset
    };
  }
  /**
   * Returns the annotation object that is currently "under the cursor".
   * NOTE: Annotations in Svedit are exclusive, so there can only be one active_annotation
   *
   * @param {string} [annotation_type] Optional annotation type to filter by
   * @returns {Annotation|null}
   */
  active_annotation(annotation_type) {
    return get_active_annotation(this.schema, this.doc, this.selection, annotation_type);
  }
  get_selected_annotated_text() {
    if (this.selection?.type !== "text") return null;
    const selection_start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
    const selection_end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
    const annotated_text = this.get(this.selection.path);
    const text = char_slice(annotated_text.text, selection_start, selection_end);
    const nodes = {};
    const annotations = annotated_text.annotations.map((a) => {
      if (selection_start < a.end_offset && selection_end > a.start_offset) {
        const sub_graph = this.traverse(a.node_id);
        for (const node of sub_graph) {
          if (!nodes[node.id]) {
            nodes[node.id] = node;
          }
        }
        return {
          start_offset: Math.max(a.start_offset - selection_start, 0),
          end_offset: Math.min(a.end_offset - selection_start, selection_end - selection_start),
          node_id: a.node_id
        };
      } else {
        return null;
      }
    }).filter(Boolean);
    return { text, annotations, nodes };
  }
  // TODO: think about ways how we can also turn a node selection into plain text.
  get_selected_plain_text() {
    if (this.selection?.type !== "text") return null;
    const start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
    const end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
    const annotated_text = this.get(this.selection.path);
    return char_slice(annotated_text.text, start, end);
  }
  get_selected_nodes() {
    if (this.selection?.type !== "node") return null;
    const start = Math.min(this.selection.anchor_offset, this.selection.focus_offset);
    const end = Math.max(this.selection.anchor_offset, this.selection.focus_offset);
    const node_array = this.get(this.selection.path);
    return snapshot(node_array.slice(start, end));
  }
  select_parent() {
    if (!this.selection) return;
    if (["text", "property"].includes(this.selection?.type)) {
      if (this.selection.path.length > 3) {
        const parent_path = this.selection.path.slice(0, -2);
        const current_index = parseInt(String(this.selection.path[this.selection.path.length - 2]));
        this.selection = {
          type: "node",
          path: parent_path,
          anchor_offset: current_index,
          focus_offset: current_index + 1
        };
      } else {
        this.selection = null;
      }
    } else if (this.selection.type === "node") {
      if (this.selection.path.length > 3) {
        const parent_path = this.selection.path.slice(0, -2);
        const current_index = parseInt(String(this.selection.path[this.selection.path.length - 2]));
        this.selection = {
          type: "node",
          path: parent_path,
          anchor_offset: current_index,
          focus_offset: current_index + 1
        };
      } else {
        this.selection = null;
      }
    } else {
      this.selection = null;
    }
  }
  /**
   * Traverses the document and returns a list of nodes in depth-first order.
   *
   * The traversal order is:
   * 1. Leaf nodes first
   * 2. Branch nodes second
   * 3. Root node (entry point) last
   *
   * @param {string} node_id - The ID of the node to start traversing from
   * @returns {Array<DocumentNode>} Array of nodes in depth-first order
   * @note Nodes that are not reachable from the entry point node will not be included
   */
  traverse(node_id) {
    return traverse(node_id, this.schema, snapshot(this.doc.nodes));
  }
  /**
   * Convert the document to a clean format for persistence.
   *
   * We make a traversal to ensure that orphaned nodes are not included,
   * and that leaf nodes go first, followed by branches and the root node at last.
   *
   * @returns {Document} The document
   */
  to_json() {
    const nodes_array = this.traverse(this.document_id);
    const nodes = Object.fromEntries(nodes_array.map((node) => [node.id, node]));
    return { document_id: this.document_id, nodes };
  }
  // property_type('page', 'body') => 'node_array'
  // property_type('paragraph', 'content') => 'annotated_text'
  property_type(type, property) {
    return property_type(this.schema, type, property);
  }
  // Count how many times a node is referenced in the document
  count_references(node_id) {
    return count_references(this.schema, this.doc, node_id);
  }
  // Get all nodes referenced by a given node (recursively)
  /**
   * @param {NodeId} node_id
   * @returns {NodeId[]}
   */
  get_referenced_nodes(node_id) {
    const traversed_nodes = this.traverse(node_id);
    return traversed_nodes.slice(0, -1).map((node) => node.id);
  }
}
function Page($$renderer, $$props) {
  let { path } = $$props;
  Node$1($$renderer, {
    path,
    children: ($$renderer2) => {
      $$renderer2.push(`<section class="card svelte-1inanki"><p class="eyebrow svelte-1inanki">Simple Svedit Example</p> `);
      NodeArrayProperty($$renderer2, { path: [...path, "body"] });
      $$renderer2.push(`<!----></section>`);
    },
    $$slots: { default: true }
  });
}
function Text($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const svedit = getContext("svedit");
    let { path } = $$props;
    let node = derived(() => svedit.session.get(path));
    let tag = derived(() => node().id === "text_1" ? "h1" : "p");
    Node$1($$renderer2, {
      path,
      children: ($$renderer3) => {
        AnnotatedTextProperty($$renderer3, {
          tag: tag(),
          path: [...path, "content"],
          placeholder: "Enter text",
          class: node().id === "text_1" ? "title" : "body"
        });
      },
      $$slots: { default: true }
    });
  });
}
const schema = define_document_schema({
  page: {
    kind: "document",
    properties: {
      body: {
        type: "node_array",
        node_types: ["text"],
        default_node_type: "text"
      }
    }
  },
  text: {
    kind: "text",
    properties: {
      content: {
        type: "annotated_text",
        node_types: [],
        allow_newlines: true
      }
    }
  }
});
const config = {
  node_components: {
    Page,
    Text
  }
};
function createRichTextSession(doc) {
  return new Session(schema, structuredClone(doc), config);
}
function RichTextFieldEditor($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { doc, label } = $$props;
    let session = createRichTextSession(doc);
    $$renderer2.push(`<div class="field svelte-kt952t"><span class="svelte-kt952t">${escape_html(label)}</span> <div class="editor-shell svelte-kt952t">`);
    Svedit($$renderer2, { session, path: [session.doc.document_id], editable: true });
    $$renderer2.push(`<!----></div></div>`);
  });
}
function PropertyEditor($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    const builder = getBuilderState();
    $$renderer2.push(`<aside class="panel svelte-5t5ncj"><h2 class="svelte-5t5ncj">Properties</h2> `);
    if (!builder.selectedInstance) {
      $$renderer2.push("<!--[0-->");
      $$renderer2.push(`<p>Select a component to edit it.</p>`);
    } else {
      $$renderer2.push("<!--[-1-->");
      const instance = builder.selectedInstance;
      const definition = builder.config.find((item) => item.id === instance.type);
      $$renderer2.push(`<div class="fields svelte-5t5ncj"><!--[-->`);
      const each_array = ensure_array_like(Object.entries(definition?.fields ?? {}));
      for (let $$index = 0, $$length = each_array.length; $$index < $$length; $$index++) {
        let [key, field] = each_array[$$index];
        if (field.type === "text" || field.type === "color") {
          $$renderer2.push("<!--[0-->");
          $$renderer2.push(`<label class="svelte-5t5ncj"><span class="svelte-5t5ncj">${escape_html(field.label)}</span> <input${attr("type", field.type === "color" ? "color" : "text")}${attr("value", instance.props[key] ?? "")} class="svelte-5t5ncj"/></label>`);
        } else if (field.type === "rich_text") {
          $$renderer2.push("<!--[1-->");
          RichTextFieldEditor($$renderer2, {
            label: field.label,
            doc: instance.richText[key]
          });
        } else {
          $$renderer2.push("<!--[-1-->");
        }
        $$renderer2.push(`<!--]-->`);
      }
      $$renderer2.push(`<!--]--></div> <button class="remove svelte-5t5ncj" type="button">Delete component</button>`);
    }
    $$renderer2.push(`<!--]--></aside>`);
  });
}
function Svaro($$renderer, $$props) {
  $$renderer.component(($$renderer2) => {
    let { config: config2, children } = $$props;
    createBuilderState(config2);
    children($$renderer2);
    $$renderer2.push(`<!---->`);
  });
}
function Hero($$renderer, $$props) {
  let {
    eyebrow = "New",
    title = "Hello world",
    description = "This is a hero block.",
    bgColor = "#f0f0f0"
  } = $$props;
  $$renderer.push(`<section class="hero svelte-1ssh2si"${attr_style(`background:${bgColor};`)}><p class="svelte-1ssh2si">${escape_html(eyebrow)}</p> <h1 class="svelte-1ssh2si">${escape_html(title)}</h1> <p class="description svelte-1ssh2si">${escape_html(description)}</p></section>`);
}
function SignupCard($$renderer, $$props) {
  let {
    title = "Join the beta",
    buttonText = "Create account",
    bgColor = "#fff6ee"
  } = $$props;
  $$renderer.push(`<section class="card svelte-1uud2ik"${attr_style(`background:${bgColor};`)}><h2 class="svelte-1uud2ik">${escape_html(title)}</h2> <label class="svelte-1uud2ik"><span>Email</span> <input type="email" placeholder="jane@company.com" class="svelte-1uud2ik"/></label> <button type="button" class="svelte-1uud2ik">${escape_html(buttonText)}</button></section>`);
}
function _page($$renderer) {
  const config2 = [
    {
      id: "hero",
      name: "Hero",
      render: Hero,
      fields: {
        eyebrow: { label: "Eyebrow", type: "text", defaultValue: "New" },
        title: {
          label: "Title",
          type: "rich_text",
          defaultValue: "Hello world"
        },
        description: {
          label: "Description",
          type: "rich_text",
          defaultValue: "This is a hero block."
        },
        bgColor: {
          label: "Background color",
          type: "color",
          defaultValue: "#f0f0f0"
        }
      }
    },
    {
      id: "signup",
      name: "Signup Card",
      render: SignupCard,
      fields: {
        title: { label: "Title", type: "text", defaultValue: "Join the beta" },
        buttonText: {
          label: "Button text",
          type: "text",
          defaultValue: "Create account"
        },
        bgColor: {
          label: "Background color",
          type: "color",
          defaultValue: "#fff6ee"
        }
      }
    }
  ];
  head("1uha8ag", $$renderer, ($$renderer2) => {
    $$renderer2.title(($$renderer3) => {
      $$renderer3.push(`<title>Svedit Builder Example</title>`);
    });
  });
  Svaro($$renderer, {
    config: config2,
    children: ($$renderer2) => {
      $$renderer2.push(`<div class="layout svelte-1uha8ag">`);
      ComponentList($$renderer2);
      $$renderer2.push(`<!----> `);
      Canvas($$renderer2);
      $$renderer2.push(`<!----> `);
      PropertyEditor($$renderer2);
      $$renderer2.push(`<!----></div>`);
    }
  });
}
export {
  _page as default
};
