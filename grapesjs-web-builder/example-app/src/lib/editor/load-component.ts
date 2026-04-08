const COMPONENT_SOURCE_ROOT = '/Users/code123/shurale/grapesjs-web-builder/component-source';

export type LoadedComponent = {
  sourcePath: string;
  moduleUrl: string;
  grapesTagName: string;
  storageKey: string;
};

function validateComponentPath(componentPath: string[]) {
  if (!componentPath.length) {
    throw new Error('Component path is required.');
  }

  for (const segment of componentPath) {
    if (!segment || segment === '.' || segment === '..' || segment.includes('/')) {
      throw new Error(`Invalid component path segment: ${segment}`);
    }
  }
}

function readGrapesTagName(sourceText: string) {
  const patterns = [
    /static\s+grapesTagName\s*=\s*['"]([^'"]+)['"]/,
    /grapesTagName\s*=\s*['"]([^'"]+)['"]/,
    /customElements\.define\(\s*['"]([^'"]+)['"]/,
  ];

  for (const pattern of patterns) {
    const match = sourceText.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  throw new Error('Component does not expose grapesTagName.');
}

export async function loadComponent(componentPath: string[]): Promise<LoadedComponent> {
  validateComponentPath(componentPath);

  const relativePath = `${componentPath.join('/')}.js`;
  const sourcePath = `${COMPONENT_SOURCE_ROOT}/${relativePath}`;
  const moduleUrl = `/@fs/${sourcePath}`;
  const response = await fetch(moduleUrl);

  if (!response.ok) {
    throw new Error(`Failed to load component source: ${relativePath}`);
  }

  const sourceText = await response.text();
  const grapesTagName = readGrapesTagName(sourceText);

  return {
    sourcePath,
    moduleUrl,
    grapesTagName,
    storageKey: `gjs:demo:${componentPath.join('/')}`,
  };
}
