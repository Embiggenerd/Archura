import type { CanonicalComponentData } from '../component-data/canonical.js';

export type ArchuraEditorConfig = {
  componentPath?: string[];
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
