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

export type ArchuraEditorConfig = {
  componentPath?: string[];
  components?: ArchuraComponentDefinition[];
  initialArtifact?: CanonicalComponentData | null;
  onReady?: () => void;
  onChange?: (artifacts: CanonicalComponentData[]) => void;
  onSave?: (result: { artifacts: CanonicalComponentData[] }) => void;
  onError?: (error: unknown) => void;
};

export type ArchuraEditorState = {
  componentPath: string[];
  html: string;
  css: string;
  ready: boolean;
};

export type ArchuraRenderable = {
  requestUpdate: () => void;
};
