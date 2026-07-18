import type { CanonicalComponentData } from '../component-data/canonical.js';

export type ArchuraComponentDefinition = {
  kind: 'component' | 'page';
  path: string[];
  tagName: string;
  moduleUrl: string;
  label?: string;
  /** Page definitions list the paths of the component definitions they compose. */
  uses?: string[][];
};

export type ArchuraEditTarget = {
  kind: 'component' | 'page';
  path: string[];
  label: string;
};

/** One stored item in a client's namespace, as returned by adapter list(). */
export type ArchuraNamespaceEntry = {
  path: string[];
  kind: 'artifact' | 'embed';
  updatedAt: string | null;
};

/**
 * The editor's entire knowledge of storage. Implemented by the host;
 * S3, R2, a local database — the editor cannot tell them apart.
 * Namespace-aware adapters (bound to a client's site) additionally expose
 * list() and publishEmbed(); bespoke host adapters may omit them.
 */
export type ArchuraPersistenceAdapter = {
  load(target: ArchuraEditTarget): Promise<CanonicalComponentData | null>;
  publish(artifact: CanonicalComponentData): Promise<void>;
  /** Enumerate everything stored in this adapter's namespace. */
  list?(): Promise<ArchuraNamespaceEntry[]>;
  /** Store a generated per-client embed module (JS source) under the namespace. */
  publishEmbed?(name: string, source: string): Promise<void>;
};

export type ArchuraEditorConfig = {
  componentPath?: string[];
  components?: ArchuraComponentDefinition[];
  persistence?: ArchuraPersistenceAdapter;
  /** Host-provided asset upload; returns the absolute URL of the stored asset. */
  uploadAsset?: (file: Blob, name: string) => Promise<string>;
  initialArtifact?: CanonicalComponentData | null;
  onReady?: () => void;
  onChange?: (artifacts: CanonicalComponentData[]) => void;
  onSave?: (result: { artifacts: CanonicalComponentData[] }) => void;
  onError?: (error: unknown) => void;
};

export type ArchuraPageMeta = {
  title?: string;
  description?: string;
};

export type ArchuraEditorState = {
  componentPath: string[];
  html: string;
  css: string;
  ready: boolean;
  pageMeta?: ArchuraPageMeta;
};

export type ArchuraRenderable = {
  requestUpdate: () => void;
};
