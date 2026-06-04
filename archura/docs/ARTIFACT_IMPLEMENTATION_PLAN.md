# Artifact Implementation Plan

This document turns the artifact model into concrete code shape.

It focuses on:

- file locations
- module responsibilities
- core functions
- storage layout
- testing strategy

It is intentionally practical and tied to the current repo.

The current repo shape is:

- `archura/component-source/`
- `archura/component-data/`
- `archura/editor/`
- `archura/docs/`

## Goal

We want the editor to:

1. extract edited component state from GrapesJS
2. save a canonical JSON artifact
3. generate consumer-specific outputs from that artifact

The canonical artifact should become the only durable source of truth.

## Recommended Code Shape

### 1. Artifact Types And Schema

File:

- `/Users/code123/shurale/archura/editor/src/lib/artifacts/artifact.ts`

Responsibility:

- define the canonical artifact TypeScript types
- export the schema version
- provide artifact validation helpers

Recommended exports:

```ts
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
  };
  meta: {
    createdAt: string;
    updatedAt: string;
  };
};
```

Recommended functions:

- `createArtifact(input)`
- `assertArtifact(value)`
- `isArtifact(value)`

### 2. Editor Extraction

File:

- `/Users/code123/shurale/archura/editor/src/lib/editor/extract-from-editor.ts`

Responsibility:

- read the live GrapesJS canvas
- find mounted custom elements
- extract HTML snapshots
- extract GrapesJS CSS
- collect asset references

Recommended functions:

- `findMountedComponents(editor)`
- `extractComponentHtml(element)`
- `extractComponentCss(editor, element)`
- `extractComponentAssets(element, css)`
- `extractEditorState(editor, componentPath)`

Suggested output:

```ts
type ExtractedEditorState = {
  componentPath: string[];
  components: Array<{
    tagName: string;
    html: string;
    css: string;
    assets: string[];
  }>;
  grapesjsCss: string;
};
```

### 3. Artifact Builder

File:

- `/Users/code123/shurale/archura/editor/src/lib/artifacts/build-artifact.ts`

Responsibility:

- turn extracted editor state into canonical artifacts
- apply ids and metadata
- keep artifact shaping out of route handlers

Recommended functions:

- `buildArtifactsFromEditorState(state)`
- `buildArtifactFromComponent(component, context)`
- `createArtifactId(componentPath, tagName, index)`

Notes:

- start with one artifact per mounted component
- each artifact should carry its own `snapshot.html` and `snapshot.css`
- `editor.grapesjsCss` can initially store the same CSS as `snapshot.css` when no distinction is needed

### 4. Artifact Store

File:

- `/Users/code123/shurale/archura/editor/src/lib/server/artifact-store.ts`

Responsibility:

- write canonical artifact JSON to disk
- read artifact JSON from disk
- resolve artifact directories

Recommended functions:

- `getArtifactsRoot()`
- `getArtifactDirectory(artifactId)`
- `writeArtifact(artifact)`
- `readArtifact(artifactId)`

Recommended on-disk layout:

```text
archura/component-data/canonical/<artifactId>/artifact.json
```

### 5. Exporters

Files:

- `/Users/code123/shurale/archura/editor/src/lib/server/exporters/embed-exporter.ts`
- `/Users/code123/shurale/archura/editor/src/lib/server/exporters/deployment-exporter.ts`
- `/Users/code123/shurale/archura/editor/src/lib/server/exporters/npm-exporter.ts`

Responsibility:

- consume canonical artifact JSON
- generate output for one target each

Recommended functions:

- `exportEmbedBundle(artifact)`
- `exportDeploymentBundle(artifact)`
- `exportNpmBundle(artifact)`

Recommended output folders:

```text
archura/component-data/exported/embed/<exportId>/
archura/component-data/exported/deployment/<exportId>/
archura/component-data/exported/npm/<exportId>/
```

### 6. API Routes

Files:

- `/Users/code123/shurale/archura/editor/src/routes/api/artifacts/[artifactId]/+server.ts`
- `/Users/code123/shurale/archura/editor/src/routes/api/artifacts/[artifactId]/export/[target]/+server.ts`

Responsibility:

- keep routes thin
- delegate to artifact store and exporters
- avoid embedding business logic in request handlers

Recommended behavior:

- `PUT /api/artifacts/[artifactId]`
  - save canonical artifact
- `GET /api/artifacts/[artifactId]`
  - return canonical artifact
- `POST /api/artifacts/[artifactId]/export/embed`
  - generate embed output
- `POST /api/artifacts/[artifactId]/export/deployment`
  - generate deployment output
- `POST /api/artifacts/[artifactId]/export/npm`
  - generate npm output

### 7. Demo Route

File:

- `/Users/code123/shurale/archura/editor/src/routes/demo/[...componentPath]/+page.svelte`

Responsibility:

- trigger save from the UI
- show success and error state
- avoid containing extraction and persistence logic directly

Recommended UI actions:

- `Save Artifact`
- later: `Export Embed`
- later: `Export Deployment`

## Recommended Directory Layout

```text
archura/editor/src/lib/artifacts/
archura/editor/src/lib/editor/
archura/editor/src/lib/server/
archura/editor/src/lib/server/exporters/
archura/editor/src/routes/api/artifacts/
archura/component-data/canonical/
archura/component-data/exported/
```

## Transition From Current Code

The repo already contains early export logic in:

- `/Users/code123/shurale/archura/editor/src/lib/editor/export-component-artifact.ts`
- `/Users/code123/shurale/archura/editor/src/lib/editor/save-component-artifact.ts`
- `/Users/code123/shurale/archura/editor/src/lib/server/component-artifacts.ts`

We should evolve that code instead of discarding it immediately.

Recommended transition:

1. keep the current extraction logic
2. move canonical artifact types into `src/lib/artifacts/artifact.ts`
3. change save flow so it writes `artifact.json` first
4. make wrapper JS, demo HTML, and future outputs derive from that saved artifact
5. gradually rename older modules once the new structure is stable

## Testing Strategy

### 1. Artifact Schema Tests

Purpose:

- verify canonical artifacts are shaped correctly

Suggested file:

- `/Users/code123/shurale/archura/editor/test/artifact-schema.test.js`

What to test:

- valid artifact objects pass
- missing required fields fail
- invalid schema version fails
- `config.componentPath` and `config.tagName` are required

### 2. Editor Extraction Tests

Purpose:

- verify we extract the right HTML, CSS, and asset refs from GrapesJS/editor DOM

Suggested file:

- `/Users/code123/shurale/archura/editor/test/editor-extraction.test.js`

What to test:

- mounted custom elements are found
- serialized HTML matches the mounted element
- CSS selection keeps the rules relevant to that component
- asset references are collected from HTML and CSS

### 3. Artifact Builder Tests

Purpose:

- verify extracted editor state becomes the expected canonical artifact

Suggested file:

- `/Users/code123/shurale/archura/editor/test/build-artifact.test.js`

What to test:

- one artifact is generated per mounted component
- artifact ids are stable and predictable enough for storage
- metadata fields are populated
- `snapshot` and `editor` sections are filled correctly

### 4. Artifact Store Tests

Purpose:

- verify artifacts are written and read correctly from disk

Suggested file:

- `/Users/code123/shurale/archura/editor/test/artifact-store.test.js`

What to test:

- `artifact.json` is written to the correct directory
- reading returns the same artifact
- repeated writes update the artifact cleanly

### 5. Exporter Tests

Purpose:

- verify derived outputs are generated from canonical artifacts

Suggested files:

- `/Users/code123/shurale/archura/editor/test/embed-exporter.test.js`
- `/Users/code123/shurale/archura/editor/test/deployment-exporter.test.js`
- `/Users/code123/shurale/archura/editor/test/npm-exporter.test.js`

What to test:

- embed exporter creates wrapper JS and demo HTML
- deployment exporter creates HTML/CSS output
- npm exporter creates package-ready wrapper output

### 6. Golden File Tests

Purpose:

- verify generated outputs do not drift unexpectedly

Suggested fixture folder:

- `/Users/code123/shurale/archura/editor/test/fixtures/`

What to test:

- known artifact in
- expected generated files out

This is especially useful for:

- generated custom-element wrapper JS
- demo HTML
- exported CSS

### 7. End-To-End Save Flow Test

Purpose:

- verify the user flow works from the demo editor route

Suggested future file:

- `/Users/code123/shurale/archura/editor/test/editor-save-flow.e2e.test.js`

What to test:

1. open `/demo/[...componentPath]`
2. edit a component
3. click save
4. confirm `artifact.json` is written
5. confirm derived embed output exists

## Recommended Test Order

Build tests in this order:

1. artifact schema tests
2. editor extraction tests
3. artifact builder tests
4. artifact store tests
5. embed exporter tests
6. golden file tests
7. end-to-end save flow test

This order gives us fast feedback on the core model before we depend on browser-heavy tests.

## Guiding Principle

Keep these layers separate:

- extraction
- artifact building
- persistence
- exporting

If those concerns stay separate, the editor remains usable as a plugin inside other products and each layer stays testable in isolation.
