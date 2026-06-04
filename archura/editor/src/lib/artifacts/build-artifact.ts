import { createArtifact, type CanonicalArtifact } from './artifact';
import type { ComponentExportBundle } from '$lib/editor/export-component-artifact';

function createArtifactId(exportId: string, componentId: string) {
  return `${exportId}--${componentId}`;
}

export function buildArtifactsFromExportBundle(bundle: ComponentExportBundle): CanonicalArtifact[] {
  return bundle.components.map((component) =>
    createArtifact({
      id: createArtifactId(bundle.exportId, component.id),
      type: 'component-instance',
      content: {},
      snapshot: {
        html: component.html,
        css: component.css,
      },
      editor: {
        grapesjsCss: component.css,
      },
      config: {
        componentPath: bundle.componentPath,
        tagName: component.tagName,
        wrapperTagName: component.wrapperTagName,
        moduleUrl: bundle.moduleUrl,
        assets: component.assets,
      },
      meta: {
        exportId: bundle.exportId,
        createdAt: bundle.generatedAt,
        updatedAt: bundle.generatedAt,
      },
    })
  );
}
