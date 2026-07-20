import type { CanonicalComponentData } from './canonical.js';

/** One component instance recorded in an artifact's content.components. */
export type EmbedInstance = {
  componentPath: string[];
  tagName: string;
  instanceId: string;
  attributes: Record<string, unknown>;
};

const SKIPPED_ATTRIBUTES = new Set(['id', 'class', 'style']);

/**
 * Pulls one instance's styling + configured traits out of a published
 * artifact, rewritten so they apply to a bare `<tag>` on any page (an embed
 * has no instance id). Two sources, matching how the editor persists styling:
 * - host custom props inlined on the element by transformForDeployment →
 *   a `tag { … }` rule;
 * - CSS rules still targeting `#instanceId` (responsive overrides in media
 *   queries, part rules like `#id [data-part="x"]`) → same rules with the id
 *   selector rewritten to the tag.
 */
export function extractInstanceEmbed(
  artifact: CanonicalComponentData,
  instance: EmbedInstance
): { css: string; traits: Record<string, string> } {
  const { tagName, instanceId } = instance;
  const rules: string[] = [];

  const doc = new DOMParser().parseFromString(artifact.snapshot.html, 'text/html');
  const el = doc.getElementById(instanceId);
  if (el?.getAttribute('style')) {
    const hostProps = [...el.style.cssText.matchAll(/(--[\w-]+)\s*:/g)]
      .map((m) => m[1])
      .map((prop) => `${prop}: ${el.style.getPropertyValue(prop).trim()};`);
    if (hostProps.length > 0) {
      rules.push(`${tagName} { ${hostProps.join(' ')} }`);
    }
  }

  const idSelector = `#${instanceId}`;
  const rewrite = (rule: CSSStyleRule): string | null => {
    if (!rule.selectorText.includes(idSelector)) return null;
    const selector = rule.selectorText.replaceAll(idSelector, tagName);
    return rule.style.cssText.trim() ? `${selector} { ${rule.style.cssText} }` : null;
  };

  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(artifact.snapshot.css);
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSStyleRule) {
        const rewritten = rewrite(rule);
        if (rewritten) rules.push(rewritten);
      } else if (rule instanceof CSSMediaRule) {
        const inner = [...rule.cssRules]
          .filter((r): r is CSSStyleRule => r instanceof CSSStyleRule)
          .map(rewrite)
          .filter((r): r is string => r !== null);
        if (inner.length > 0) {
          rules.push(`@media ${rule.media.mediaText} { ${inner.join(' ')} }`);
        }
      }
    }
  } catch {
    // Unparseable artifact CSS: fall through with whatever was collected.
  }

  const traits: Record<string, string> = {};
  for (const [name, value] of Object.entries(instance.attributes ?? {})) {
    if (SKIPPED_ATTRIBUTES.has(name) || name.startsWith('data-gjs')) continue;
    if (value === false || value == null) continue;
    traits[name] = value === true ? '' : String(value);
  }

  return { css: rules.join('\n'), traits };
}

/**
 * Builds every embed module an artifact implies: one per component instance,
 * named by component (later instances of the same component win). Shared by
 * the controller's publish path and the anonymous deploy modal so the two
 * cannot drift. `baseHref` resolves relative module URLs (usually
 * location.href).
 */
export function buildEmbedModules(
  artifact: CanonicalComponentData,
  definitions: ReadonlyArray<{ path: string[]; moduleUrl: string; kind?: string; tagName?: string }>,
  baseHref: string
): Array<{ name: string; tag: string; source: string }> {
  const instances = (artifact.content.components ?? []) as EmbedInstance[];
  const modules = new Map<string, { name: string; tag: string; source: string }>();
  for (const instance of instances) {
    const definition = definitions.find((d) => d.path.join('/') === instance.componentPath.join('/'));
    if (!definition) continue;
    const { css, traits } = extractInstanceEmbed(artifact, instance);
    const moduleUrl = new URL(definition.moduleUrl, baseHref).href;
    const name = `${instance.componentPath.at(-1)}.js`;
    modules.set(name, {
      name,
      tag: instance.tagName,
      source: generateEmbedModule({ moduleUrl, tag: instance.tagName, css, traits }),
    });
  }

  // A page-sized component embed is additive: it packages the deployment snapshot
  // with the same light-DOM CSS behavior as the leaf modules above. The leaf
  // module loop intentionally remains last-instance-wins.
  const pageDefinition = definitions.find(
    (definition) =>
      definition.kind === 'page' &&
      definition.path.join('/') === artifact.config.componentPath.join('/')
  );
  if (pageDefinition?.tagName) {
    const moduleUrl = new URL(pageDefinition.moduleUrl, baseHref).href;
    const name = `${pageDefinition.path.at(-1)}.js`;
    modules.set(name, {
      name,
      tag: pageDefinition.tagName,
      source: generatePageEmbedModule({
        moduleUrl,
        tag: pageDefinition.tagName,
        css: artifact.snapshot.css,
        html: artifact.snapshot.html,
      }),
    });
  }
  return [...modules.values()];
}

export function generatePageEmbedModule(options: {
  moduleUrl: string;
  tag: string;
  css: string;
  html: string;
}): string {
  const { moduleUrl, tag, css, html } = options;
  return `// Generated by Archura — per-client page embed module. Do not edit by hand;
// re-publishing from the editor overwrites this file.
import ${JSON.stringify(moduleUrl)};

const TAG = ${JSON.stringify(tag)};
const CSS = ${JSON.stringify(css)};
const HTML = ${JSON.stringify(html)};

const styleId = 'archura-embed-' + TAG;
if (CSS && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = CSS;
  document.head.appendChild(style);
}

await customElements.whenDefined(TAG);
for (const el of document.querySelectorAll(TAG)) {
  if ('updateComplete' in el) await el.updateComplete;
  el.innerHTML = HTML;
}
`;
}

/**
 * Emits the per-client embed module: one JS file that imports the shared
 * (immutable) component module, injects the client's styling once per
 * document, and stamps configured traits onto any bare elements already on
 * the page. Publishing overwrites this module, which is what makes an edit
 * live on every embedding page's next load.
 */
export function generateEmbedModule(options: {
  moduleUrl: string;
  tag: string;
  css: string;
  traits: Record<string, string>;
}): string {
  const { moduleUrl, tag, css, traits } = options;
  return `// Generated by Archura — per-client embed module. Do not edit by hand;
// re-publishing from the editor overwrites this file.
import ${JSON.stringify(moduleUrl)};

const TAG = ${JSON.stringify(tag)};
const CSS = ${JSON.stringify(css)};
const TRAITS = ${JSON.stringify(traits, null, 2)};

const styleId = 'archura-embed-' + TAG;
if (CSS && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = CSS;
  document.head.appendChild(style);
}

for (const el of document.querySelectorAll(TAG)) {
  for (const [name, value] of Object.entries(TRAITS)) {
    if (!el.hasAttribute(name)) el.setAttribute(name, value);
  }
}
`;
}
