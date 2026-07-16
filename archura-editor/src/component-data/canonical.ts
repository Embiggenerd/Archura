export const CANONICAL_COMPONENT_DATA_VERSION = 1;

export type CanonicalComponentData = {
  schemaVersion: number;
  id: string;
  type: 'component-instance';
  content: Record<string, unknown>;
  snapshot: {
    html: string;
    css: string;
  };
  config: {
    componentPath: string[];
  };
  meta: {
    createdAt: string;
    updatedAt: string;
  };
};

export function createCanonicalComponentData(
  input: Omit<CanonicalComponentData, 'schemaVersion'>
): CanonicalComponentData {
  return {
    schemaVersion: CANONICAL_COMPONENT_DATA_VERSION,
    ...input,
  };
}

export function isCanonicalComponentData(value: unknown): value is CanonicalComponentData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as Partial<CanonicalComponentData>;
  return (
    data.schemaVersion === CANONICAL_COMPONENT_DATA_VERSION &&
    typeof data.id === 'string' &&
    data.type === 'component-instance' &&
    !!data.snapshot &&
    typeof data.snapshot.html === 'string' &&
    typeof data.snapshot.css === 'string' &&
    !!data.config &&
    Array.isArray(data.config.componentPath) &&
    !!data.meta &&
    typeof data.meta.createdAt === 'string' &&
    typeof data.meta.updatedAt === 'string'
  );
}
