import { buildComponentModuleUrl } from './load-component';

export type EditorCanvasLike = {
  Canvas?: {
    getDocument?: () => Document | null;
    getBody?: () => HTMLElement | null;
    getWindow?: () => Window | null;
  };
  getProjectData?: () => unknown;
  getCss?: () => string;
};

export type ExportedComponentArtifact = {
  id: string;
  tagName: string;
  wrapperTagName: string;
  htmlFileName: string;
  cssFileName: string;
  assetFileName: string;
  jsFileName: string;
  demoFileName: string;
  html: string;
  css: string;
  assets: string[];
};

export type ComponentExportBundle = {
  exportId: string;
  componentPath: string[];
  moduleUrl: string;
  sourceCss: string;
  generatedAt: string;
  components: ExportedComponentArtifact[];
};

type ProjectNode = {
  tagName?: string;
  components?: ProjectNode[];
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'component';
}

function collectProjectTagNames(node: unknown, tagNames = new Set<string>()) {
  if (!node || typeof node !== 'object') {
    return tagNames;
  }

  const maybeNode = node as ProjectNode;
  if (typeof maybeNode.tagName === 'string' && maybeNode.tagName.includes('-')) {
    tagNames.add(maybeNode.tagName.toLowerCase());
  }

  if (Array.isArray(maybeNode.components)) {
    for (const child of maybeNode.components) {
      collectProjectTagNames(child, tagNames);
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectProjectTagNames(item, tagNames);
      }
    }
  }

  return tagNames;
}

function getCanvasBody(editor: EditorCanvasLike) {
  return (
    editor.Canvas?.getBody?.() ??
    editor.Canvas?.getDocument?.()?.body ??
    null
  );
}

function findMountedCustomElements(editor: EditorCanvasLike) {
  const body = getCanvasBody(editor);
  if (!body) {
    throw new Error('Canvas body unavailable.');
  }

  const projectTagNames = collectProjectTagNames(editor.getProjectData?.());
  const allCustomElements = Array.from(body.querySelectorAll('*')).filter((element) =>
    element.tagName.toLowerCase().includes('-')
  );

  const mountedElements = allCustomElements.filter((element) => {
    if (!projectTagNames.size) {
      return true;
    }

    return projectTagNames.has(element.tagName.toLowerCase());
  });

  return { body, mountedElements };
}

function parseCssRules(sourceCss: string) {
  const style = document.createElement('style');
  style.textContent = sourceCss;
  document.head.appendChild(style);

  try {
    return Array.from(style.sheet?.cssRules ?? []);
  } finally {
    style.remove();
  }
}

function selectorMatchesSubtree(root: ParentNode, element: Element, selector: string) {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    return false;
  }

  const partIndex = trimmedSelector.indexOf('::part(');
  if (partIndex >= 0) {
    const hostSelector = trimmedSelector.slice(0, partIndex).trim();
    if (!hostSelector) {
      return false;
    }

    const matchingHosts = Array.from(root.querySelectorAll(hostSelector));
    return matchingHosts.some((host) => host === element || element.contains(host));
  }

  try {
    const matches = Array.from(root.querySelectorAll(trimmedSelector));
    return matches.some((match) => match === element || element.contains(match));
  } catch {
    return false;
  }
}

function shouldKeepStyleRule(rule: CSSStyleRule, root: ParentNode, element: Element) {
  return rule.selectorText
    .split(',')
    .some((selector) => selectorMatchesSubtree(root, element, selector));
}

function filterRuleForElement(rule: CSSRule, root: ParentNode, element: Element): string {
  if (rule instanceof CSSStyleRule) {
    return shouldKeepStyleRule(rule, root, element) ? rule.cssText : '';
  }

  if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
    const nestedCss = Array.from(rule.cssRules)
      .map((nestedRule) => filterRuleForElement(nestedRule, root, element))
      .filter(Boolean)
      .join('\n');

    if (!nestedCss) {
      return '';
    }

    const conditionText = 'conditionText' in rule ? rule.conditionText : '';
    const prefix = rule instanceof CSSMediaRule ? '@media' : '@supports';
    return `${prefix} ${conditionText} {\n${nestedCss}\n}`;
  }

  return rule.cssText;
}

function extractCssForElement(sourceCss: string, root: ParentNode, element: Element) {
  if (!sourceCss.trim()) {
    return '';
  }

  return parseCssRules(sourceCss)
    .map((rule) => filterRuleForElement(rule, root, element))
    .filter(Boolean)
    .join('\n');
}

function extractHtmlAssetRefs(element: Element) {
  const refs = new Set<string>();
  const assetSelectors = [
    '[src]',
    '[href]',
    '[poster]',
  ];

  const nodes = [element, ...Array.from(element.querySelectorAll(assetSelectors.join(',')))];

  for (const node of nodes) {
    for (const attributeName of ['src', 'href', 'poster']) {
      const value = node.getAttribute(attributeName);
      if (value) {
        refs.add(value);
      }
    }
  }

  return refs;
}

function extractCssAssetRefs(cssText: string) {
  const refs = new Set<string>();
  const urlPattern = /url\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = urlPattern.exec(cssText))) {
    const value = match[1]?.trim().replace(/^['"]|['"]$/g, '');
    if (value) {
      refs.add(value);
    }
  }

  return refs;
}

function collectAssetRefs(element: Element, cssText: string) {
  return Array.from(new Set([
    ...extractHtmlAssetRefs(element),
    ...extractCssAssetRefs(cssText),
  ])).sort();
}

function createExportId(componentPath: string[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${slugify(componentPath.join('-'))}--${timestamp}`;
}

export function exportComponentArtifacts(
  editor: EditorCanvasLike,
  componentPath: string[]
): ComponentExportBundle {
  const { body, mountedElements } = findMountedCustomElements(editor);
  const sourceCss = editor.getCss?.() ?? '';

  if (!mountedElements.length) {
    throw new Error('No mounted custom elements found in the editor canvas.');
  }

  const components = mountedElements.map((element, index) => {
    const tagName = element.tagName.toLowerCase();
    const fileStem = `${String(index + 1).padStart(3, '0')}-${slugify(tagName)}`;
    const css = extractCssForElement(sourceCss, body, element);
    const wrapperTagName = `exported-${slugify(componentPath.join('-'))}-${String(index + 1).padStart(3, '0')}`;

    return {
      id: fileStem,
      tagName,
      wrapperTagName,
      htmlFileName: `${fileStem}.html`,
      cssFileName: `${fileStem}.css`,
      assetFileName: `${fileStem}.assets.json`,
      jsFileName: `${fileStem}.js`,
      demoFileName: `${fileStem}-demo.html`,
      html: element.outerHTML,
      css,
      assets: collectAssetRefs(element, css),
    };
  });

  return {
    exportId: createExportId(componentPath),
    componentPath,
    moduleUrl: buildComponentModuleUrl(componentPath),
    sourceCss,
    generatedAt: new Date().toISOString(),
    components,
  };
}
