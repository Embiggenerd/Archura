import {
  exportComponentArtifacts,
  type ComponentExportBundle,
  type EditorCanvasLike,
} from './export-component-artifact';
import { buildArtifactsFromExportBundle } from '$lib/artifacts/build-artifact';

export async function saveComponentArtifacts(
  editor: EditorCanvasLike,
  componentPath: string[]
): Promise<ComponentExportBundle> {
  const bundle = exportComponentArtifacts(editor, componentPath);
  const artifacts = buildArtifactsFromExportBundle(bundle);
  const response = await fetch(`/api/component-artifacts/${encodeURIComponent(bundle.exportId)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ artifacts }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to save component artifacts.');
  }

  return bundle;
}
