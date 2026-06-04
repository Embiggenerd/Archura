export const ARTIFACT_SCHEMA_VERSION = 1;

export type CanonicalArtifact = {
  schemaVersion: number;
  id: string;
  type: 'component-instance';
  content: Record<string, unknown>;
  snapshot: {
    html: string;
    css: string;
  };
  editor: {
    grapesjsCss: string;
  };
  config: {
    componentPath: string[];
    tagName: string;
    wrapperTagName: string;
    moduleUrl: string;
    assets: string[];
  };
  meta: {
    exportId: string;
    createdAt: string;
    updatedAt: string;
  };
};

export function createArtifact(input: Omit<CanonicalArtifact, 'schemaVersion'>): CanonicalArtifact {
  return {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    ...input,
  };
}

export function isArtifact(value: unknown): value is CanonicalArtifact {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const artifact = value as Partial<CanonicalArtifact>;
  return (
    artifact.schemaVersion === ARTIFACT_SCHEMA_VERSION &&
    typeof artifact.id === 'string' &&
    artifact.type === 'component-instance' &&
    !!artifact.snapshot &&
    typeof artifact.snapshot.html === 'string' &&
    typeof artifact.snapshot.css === 'string' &&
    !!artifact.editor &&
    typeof artifact.editor.grapesjsCss === 'string' &&
    !!artifact.config &&
    Array.isArray(artifact.config.componentPath) &&
    typeof artifact.config.tagName === 'string' &&
    typeof artifact.config.wrapperTagName === 'string' &&
    typeof artifact.config.moduleUrl === 'string' &&
    Array.isArray(artifact.config.assets) &&
    !!artifact.meta &&
    typeof artifact.meta.exportId === 'string' &&
    typeof artifact.meta.createdAt === 'string' &&
    typeof artifact.meta.updatedAt === 'string'
  );
}

export function assertArtifact(value: unknown): asserts value is CanonicalArtifact {
  if (!isArtifact(value)) {
    throw new Error('Invalid canonical artifact.');
  }
}
