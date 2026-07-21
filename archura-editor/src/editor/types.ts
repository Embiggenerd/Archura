import type { CanonicalComponentData } from '../component-data/canonical.js';

export type ArchuraComponentDefinition = {
  /** Editor layout/composition category only; every definition is embeddable. */
  kind: 'component' | 'page';
  path: string[];
  tagName: string;
  moduleUrl: string;
  label?: string;
  /** Page definitions list the paths of the component definitions they compose. */
  uses?: string[][];
};

export type ArchuraEditTarget = {
  /** Editor layout/composition category only; every target publishes identically. */
  kind: 'component' | 'page';
  path: string[];
  label: string;
};

/** One stored object, as returned by a store's list(). */
export type ArchuraStoreEntry = {
  key: string;
  updatedAt: string | null;
};

/**
 * The editor's entire knowledge of storage: an opaque key -> value store, and
 * the seam for swapping backends. The editor serializes above this layer, so a
 * store never sees an "artifact", an "embed", a "publish" or a "deploy" — it
 * only get()s and put()s serialized text (JSON artifacts, JS embed modules)
 * under string keys. Implement it over R2, a filesystem, Postgres, localStorage
 * — the editor cannot tell them apart, and there are no hidden capability rules.
 *
 * The editor core calls only get() and put(). delete() and list() are optional
 * extras for host tooling (dashboards, cleanup); the editor never calls them.
 */
export type ArchuraStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete?(key: string): Promise<void>;
  /** Enumerate stored objects whose key starts with `prefix`. Host-tooling only. */
  list?(prefix: string): Promise<ArchuraStoreEntry[]>;
};

export type ArchuraEditorConfig = {
  componentPath?: string[];
  components?: ArchuraComponentDefinition[];
  persistence?: ArchuraStore;
  /** Host-provided asset upload; returns the absolute URL of the stored asset. */
  uploadAsset?: (file: Blob, name: string) => Promise<string>;
  initialArtifact?: CanonicalComponentData | null;
  onReady?: () => void;
  onChange?: (artifacts: CanonicalComponentData[]) => void;
  onSave?: (result: { artifacts: CanonicalComponentData[]; published?: boolean }) => void;
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
