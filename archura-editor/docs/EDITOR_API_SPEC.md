# Editor API Spec

This document defines the first concrete API for `archura-editor`.

It focuses on:

- `ArchuraEditorController`
- Lit-based editor primitives
- `<archura-editor>` as the default composition
- config and save contract

## 1. Controller API

The controller is the engine used by the Lit UI layer.

Primary shape:

```ts
const editor = new ArchuraEditorController(config);
```

### Constructor

```ts
new ArchuraEditorController(config: ArchuraEditorConfig)
```

### Methods

- `init(): Promise<void>`
- `render(container: HTMLElement): void`
- `save(): Promise<CanonicalArtifact[]>`
- `getArtifacts(): CanonicalArtifact[]`
- `loadArtifact(artifact: CanonicalArtifact): Promise<void>`
- `destroy(): void`

### Example

```ts
const editor = new ArchuraEditorController({
  componentPath: ['cards', 'Card']
});

await editor.init();
editor.render(document.getElementById('editor-root')!);
```

## 2. Shared Config Shape

```ts
type ArchuraEditorConfig = {
  componentPath?: string[];
  initialArtifact?: CanonicalArtifact | null;
  onReady?: () => void;
  onChange?: (artifacts: CanonicalArtifact[]) => void;
  onSave?: (result: { artifacts: CanonicalArtifact[] }) => void;
  onError?: (error: unknown) => void;
};
```

### Config Notes

- `componentPath`
  tells the editor which base component to edit

- `initialArtifact`
  lets a host restore editor state from a canonical artifact

- callbacks are optional convenience hooks

## 3. Lit Elements

The UI layer should be built with Lit.

### `<archura-editor>`

The full editor element is the easiest integration surface.

#### Usage

```html
<archura-editor></archura-editor>
```

#### Properties

- `componentPath: string[]`
- `initialArtifact: CanonicalArtifact | null`

#### Events

- `editorready`
- `artifactchange`
- `artifactsave`
- `editorerror`

The element should use `ArchuraEditorController` internally.

### Lower-Level Elements

These elements should be able to bind to the same controller instance.

#### `<archura-editor-shell>`

Responsible for:

- coordinating layout
- connecting child elements to the controller

#### `<archura-canvas>`

Responsible for:

- rendering the editable component area

#### `<archura-styling-panel>`

Responsible for:

- rendering styling controls for the selected component

#### `<archura-toolbar>`

Responsible for:

- high-level editor actions such as save and reset

## 4. First Implementation Priority

Implement in this order:

1. `ArchuraEditorController`
2. `<archura-canvas>`
3. `<archura-styling-panel>`
4. `<archura-toolbar>`
5. `<archura-editor>`

This keeps the controller and low-level Lit primitives stable before the default assembled editor is added.
