// The keyspace convention shared by the editor and every ArchuraStore adapter.
// The editor addresses stored objects by opaque string key; these helpers are
// the single source of truth for how those keys are shaped. An artifact is
// keyed by its component path ("cards/Card"); an embed module lives under an
// "embed/" prefix ("embed/Card.js"). A store adapter only needs isEmbedKey to
// route a key onto its backend — it never has to understand what the bytes are.

export const artifactKey = (componentPath: string[]): string => componentPath.join('/');

// A save persists the working source to the draft key without touching what is
// served; publish promotes it to the artifact key. So content can be saved
// without being published, and the editor reopens the draft over the published.
export const draftKey = (componentPath: string[]): string => `${artifactKey(componentPath)}.draft`;

export const embedKey = (name: string): string => `embed/${name}`;

export const isEmbedKey = (key: string): boolean => key.startsWith('embed/');
