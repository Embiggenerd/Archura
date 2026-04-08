# Service Node And Interface Design

## Purpose

This document describes the system as a set of service nodes connected by typed inputs and outputs.

The goal is to make it clear:

- what each service is responsible for
- what data each service accepts
- what data each service returns
- which service boundaries should become API contracts

This document is a target architecture reference, not the recommended first implementation step. The actual build should start from the concrete Svelte plugin and authoring runtime, then extract these contracts after the real editing and persistence flows are working.

## System Graph

```text
+---------------------------+
| Humans And Agents         |
| client / agent / dev      |
+---------------------------+
             |
             v
+---------------------------+
| Studio UI                 |
| dashboard + WYSIWYG       |
+---------------------------+
      |            |
      | edit/view  | run / publish
      v            v
+---------------------------+        +---------------------------+
| Authoring Runtime         | <----> | Run Manager              |
| live browser-backed       |        | coordinates runs         |
| editing + preview         |        | providers + policies     |
+---------------------------+        +---------------------------+
      |            |                         |         |        |
      | validate   | save source/state       |         |        |
      v            v                         v         v        v
+-------------+  +-------------------+   +----------------+  +------------------+
| Core        |  | Artifact Store    |   | Agent Adapter  |  | Observability    |
| schemas +   |  | templates/designs |   | Codex/Kimi/    |  | events/streams   |
| rules        |  | fixtures/.svelte  |   | Qwen           |  +------------------+
+-------------+  +-------------------+   +----------------+           |
                        |                          ^                   |
                        | source/build refs        | task results      |
                        v                          |                   v
                 +-------------------+             |         +-------------------+
                 | Compiler          |-------------+         | Viewers            |
                 | Svelte -> web     | build result          | studio/client/dev  |
                 | component         |                       +-------------------+
                 +-------------------+
                        |
                        | deployable build
                        v
                 +-------------------+
                 | Deployment        |
                 | preview + prod    |
                 | publish/rollback  |
                 +-------------------+
                        |
                        v
                 +-------------------+
                 | Live Client Pages |
                 | latest published  |
                 | web components    |
                 +-------------------+
```

How to read this diagram:

- top to bottom is the main flow from editing to live deployment
- left side is authoring and data storage
- center is run coordination
- right side is providers and observability
- the deployment path is at the bottom

## Node Summary

### 1. Studio UI

Responsibilities:

- present the WYSIWYG editor
- let clients, agents, and devs view or control runs
- show preview, draft, publish, and observability surfaces

Inputs:

- `WorkspaceContext`
- `PageContext`
- `AuthoringSessionState`
- `RunRecord`
- `RunEvent`
- `PreviewDescriptor`

Outputs:

- `EditAction`
- `StageRunRequest`
- `PublishRequest`
- `RollbackRequest`

### 2. Core

Responsibilities:

- validate schemas
- normalize artifacts
- enforce template/design rules
- build comparison plans

Inputs:

- `TemplateArtifact`
- `DesignArtifact`
- `FixtureArtifact`
- `StageRunSpec`
- `VerificationRequest`

Outputs:

- `ValidationResult`
- `NormalizedArtifact`
- `CompatibilityResult`
- `ComparisonPlan`

### 3. Authoring Runtime

Responsibilities:

- load the editable page in a browser-backed runtime
- apply WYSIWYG changes
- keep authoring state and generated `.svelte` synchronized
- generate preview state
- trigger verification hooks

Inputs:

- `AuthoringSessionSpec`
- `EditAction`
- `StageConfig`
- `FixtureSelection`
- `PreviewRequest`

Outputs:

- `AuthoringSessionState`
- `SourceArtifact`
- `PreviewDescriptor`
- `VerificationCheckpoint`
- `RunEvent`

### 4. Artifact Store

Responsibilities:

- persist templates
- persist designs
- persist fixtures
- persist generated `.svelte`
- persist draft and published artifact metadata
- support rollback

Inputs:

- `ArtifactWriteRequest`
- `ArtifactQuery`
- `PublishRequest`
- `RollbackRequest`

Outputs:

- `ArtifactRecord`
- `ArtifactVersion`
- `PublishRecord`
- `RollbackResult`

### 5. Agent Adapter

Responsibilities:

- translate provider-specific execution into the platform task protocol
- submit stage runs to Codex, Kimi, Qwen, or other providers
- stream provider task events

Inputs:

- `StageRunSpec`
- `TaskStatusRequest`
- `TaskCancelRequest`

Outputs:

- `AgentTaskReceipt`
- `AgentTaskStatus`
- `AgentTaskResult`
- `RunEvent`

### 6. Run Manager

Responsibilities:

- create and coordinate runs
- choose provider
- attach a run to a browser-backed authoring session
- apply stage policy
- trigger verification and build steps
- coordinate publish and observability

Inputs:

- `StageRunRequest`
- `RunControlRequest`
- `PublishRequest`
- `RollbackRequest`

Outputs:

- `RunRecord`
- `StageRunSpec`
- `RunEvent`
- `ApprovalRequest`

### 7. Compiler

Responsibilities:

- compile `.svelte` to native web components
- generate build artifacts
- emit build metadata

Inputs:

- `BuildSpec`
- `SourceArtifact`

Outputs:

- `BuildResult`
- `BuildArtifact`

### 8. Deployment Service

Responsibilities:

- publish preview builds
- publish production builds
- rollback to previous builds

Inputs:

- `DeploySpec`
- `RollbackRequest`

Outputs:

- `DeploymentRecord`
- `DeploymentStatus`
- `RollbackResult`

### 9. Observability Stream

Responsibilities:

- stream run events
- stream debug data
- optionally stream live frames or video
- support client and dev viewers with different visibility policies

Inputs:

- `RunEvent`
- `ObservabilityProfile`
- `StreamRequest`

Outputs:

- `EventStreamMessage`
- `StreamDescriptor`

## Arrows And Contracts

## Studio UI -> Authoring Runtime

Purpose:

- apply visual edits and request preview updates

Input type:

```ts
export interface EditAction {
  actor: "client" | "agent" | "dev";
  target: string;
  action: string;
  payload: Record<string, unknown>;
  stage?: string;
}
```

Output type:

```ts
export interface AuthoringSessionState {
  sessionId: string;
  workspaceId: string;
  pageId: string;
  templateId: string;
  designId: string;
  fixtureId?: string;
  selectedTarget?: string;
  dirty: boolean;
  lastGeneratedSourceRef?: string;
}
```

## Studio UI -> Run Manager

Purpose:

- request a new stage run, approve a run, cancel a run, or publish a result

Input type:

```ts
export interface StageRunRequest {
  workspaceId: string;
  pageId: string;
  target: string;
  stage: string;
  focus?: string;
  enabled: boolean;
  verificationStrategy: "computed-style" | "layout" | "structural" | "visual" | "hybrid";
  providers: string[];
  observabilityProfile: "default" | "debug" | "showcase";
}
```

Output type:

```ts
export interface RunRecord {
  runId: string;
  workspaceId: string;
  pageId: string;
  status: "queued" | "running" | "paused" | "failed" | "completed" | "cancelled";
  provider?: string;
  sessionId?: string;
  previewUrl?: string;
  createdAt: string;
}
```

## Run Manager -> Agent Adapter

Purpose:

- execute a stage run using a provider

Input type:

```ts
export interface StageRunSpec {
  runId: string;
  workspaceId: string;
  pageId: string;
  target: string;
  stage: string;
  focus?: string;
  editableArtifacts: ArtifactRef[];
  lockedArtifacts: ArtifactRef[];
  verificationStrategy: "computed-style" | "layout" | "structural" | "visual" | "hybrid";
  observabilityProfile: "default" | "debug" | "showcase";
  successCriteria?: {
    maxVisualDiffPercent?: number;
    mustPassFixtures?: boolean;
  };
}
```

Output type:

```ts
export interface AgentTaskResult {
  taskId: string;
  provider: string;
  status: "completed" | "failed" | "cancelled";
  proposedActions: EditAction[];
  summary: string;
  metrics?: {
    durationMs: number;
    retryCount: number;
  };
}
```

## Run Manager -> Authoring Runtime

Purpose:

- attach a run to an authoring session and apply agent-proposed actions

Input type:

```ts
export interface AuthoringSessionSpec {
  workspaceId: string;
  pageId: string;
  templateId: string;
  designId: string;
  fixtureId?: string;
  stage?: string;
  observabilityProfile?: "default" | "debug" | "showcase";
}
```

Output type:

```ts
export interface VerificationCheckpoint {
  checkpointId: string;
  runId?: string;
  strategy: "computed-style" | "layout" | "structural" | "visual" | "hybrid";
  passed: boolean;
  summary: string;
  createdAt: string;
}
```

## Authoring Runtime -> Artifact Store

Purpose:

- persist updated authoring state and generated `.svelte`

Input type:

```ts
export interface ArtifactWriteRequest<T = unknown> {
  workspaceId: string;
  kind: "template" | "design" | "fixture" | "svelte-source" | "build" | "publish-record";
  id: string;
  payload: T;
  actor: "client" | "agent" | "dev" | "system";
  message?: string;
}
```

Output type:

```ts
export interface ArtifactRecord<T = unknown> {
  ref: ArtifactRef;
  payload: T;
  createdAt: string;
  updatedAt: string;
  createdBy: "client" | "agent" | "dev" | "system";
}
```

## Artifact Store -> Compiler

Purpose:

- provide source artifacts for build

Input type:

```ts
export interface BuildSpec {
  workspaceId: string;
  sourceRef: ArtifactRef;
  outputKind: "web-component";
  customElementTag: string;
  compilerOptions?: Record<string, unknown>;
}
```

Output type:

```ts
export interface BuildResult {
  buildId: string;
  status: "queued" | "running" | "completed" | "failed";
  sourceRef: ArtifactRef;
  entryFile?: string;
  assets: Array<{
    path: string;
    url: string;
  }>;
  tagName: string;
}
```

## Compiler -> Deployment Service

Purpose:

- deploy a successful build to preview or production

Input type:

```ts
export interface DeploySpec {
  workspaceId: string;
  buildId: string;
  environment: "preview" | "production";
  targetScope: {
    clientId: string;
    siteId?: string;
    pageId?: string;
    componentId?: string;
  };
}
```

Output type:

```ts
export interface DeploymentRecord {
  deploymentId: string;
  buildId: string;
  environment: "preview" | "production";
  status: "queued" | "deploying" | "live" | "failed" | "rolled_back";
  deployedAt?: string;
  urls: string[];
}
```

## Run Manager -> Observability Stream

Purpose:

- broadcast lifecycle, edit, verification, and deployment events

Input type:

```ts
export type RunEvent =
  | { type: "run.created"; runId: string; at: string }
  | { type: "run.started"; runId: string; at: string }
  | { type: "edit.applied"; runId: string; target: string; action: string; at: string }
  | { type: "preview.updated"; runId: string; previewUrl: string; at: string }
  | { type: "verification.completed"; runId: string; strategy: string; passed: boolean; at: string }
  | { type: "build.completed"; runId: string; buildId: string; at: string }
  | { type: "deployment.completed"; runId: string; deploymentId: string; at: string }
  | { type: "run.completed"; runId: string; at: string }
  | { type: "run.failed"; runId: string; reason: string; at: string };
```

Output type:

```ts
export interface EventStreamMessage {
  runId: string;
  event: RunEvent;
}
```

## Shared Types

```ts
export interface ArtifactRef {
  workspaceId: string;
  kind: "template" | "design" | "fixture" | "svelte-source" | "build" | "publish-record";
  id: string;
  version?: string;
}
```

```ts
export interface TemplateArtifact {
  id: string;
  domain?: string;
  root: Record<string, unknown>;
  contracts?: {
    form?: Record<string, unknown>;
    api?: Record<string, unknown>;
  };
}
```

```ts
export interface DesignArtifact {
  id: string;
  templateId: string;
  spatialRules?: Record<string, unknown>;
  tokens?: Record<string, string>;
  variants?: Record<string, string>;
  stateRules?: Record<string, unknown>;
}
```

```ts
export interface FixtureArtifact {
  id: string;
  extends?: string;
  data: Record<string, unknown>;
}
```

```ts
export interface SourceArtifact {
  id: string;
  componentId: string;
  source: string;
  generatedFrom: {
    templateId?: string;
    designId?: string;
    fixtureId?: string;
  };
}
```

```ts
export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}
```

```ts
export interface PublishRequest {
  workspaceId: string;
  artifactRef: ArtifactRef;
  environment: "preview" | "production";
  actor: "client" | "agent" | "dev";
}
```

```ts
export interface RollbackRequest {
  workspaceId: string;
  targetRef: ArtifactRef;
  toVersion: string;
  actor: "client" | "agent" | "dev";
}
```

```ts
export interface RollbackResult {
  ok: boolean;
  targetRef: ArtifactRef;
  activeVersion: string;
}
```

## External API Sketch

These are likely first routes if the run manager and artifact store expose HTTP APIs.

### Run Manager API

- `POST /runs`
- `GET /runs/:runId`
- `POST /runs/:runId/cancel`
- `POST /runs/:runId/approve`
- `GET /runs/:runId/events`

### Artifact Store API

- `GET /artifacts/:kind/:id`
- `POST /artifacts/:kind`
- `POST /artifacts/:kind/:id/publish`
- `POST /artifacts/:kind/:id/rollback`

### Build API

- `POST /builds`
- `GET /builds/:buildId`

### Deployment API

- `POST /deployments`
- `GET /deployments/:deploymentId`
- `POST /deployments/:deploymentId/rollback`

## Request Trace Diagram

This diagram shows what happens when someone makes an edit, the system saves it as a draft, and the draft is either rejected or approved for deployment.

```text
+------------------+
| Client / Agent   |
| / Dev            |
+------------------+
         |
         | EditAction
         v
+------------------+
| Studio UI        |
+------------------+
         |
         | EditAction
         v
+------------------+
| Authoring        |
| Runtime          |
+------------------+
         |
         | applies visual edit
         | updates WYSIWYG state
         | regenerates .svelte
         | refreshes preview
         |
         +----------------------------+
         |                            |
         | ArtifactWriteRequest       | VerificationRequest
         v                            v
+------------------+         +------------------+
| Artifact Store   |         | Core /           |
| draft saved      |         | Verification     |
+------------------+         +------------------+
         |                            |
         | ArtifactRecord             | ValidationResult /
         |                            | VerificationCheckpoint
         +-------------+--------------+
                       |
                       v
               +------------------+
               | Studio UI        |
               | draft visible    |
               | on client        |
               | subdomain        |
               +------------------+
                       |
                       | approve?
             +---------+---------+
             |                   |
             | no                | yes
             v                   v
   +------------------+   +------------------+
   | Draft remains    |   | Run Manager      |
   | unpublished      |   +------------------+
   | production       |            |
   | unchanged        |            | PublishRequest
   +------------------+            v
                          +------------------+
                          | Artifact Store   |
                          | resolve approved |
                          | source ref       |
                          +------------------+
                                    |
                                    | BuildSpec
                                    v
                          +------------------+
                          | Compiler         |
                          | compile .svelte  |
                          | to web component |
                          +------------------+
                                    |
                                    | BuildResult
                                    v
                          +------------------+
                          | Deployment       |
                          | Service          |
                          +------------------+
                                    |
                                    | DeploymentRecord
                                    v
                          +------------------+
                          | Artifact Store   |
                          | published record |
                          +------------------+
                                    |
                                    | deployment completed
                                    v
                          +------------------+
                          | Live page uses   |
                          | latest published |
                          | component on     |
                          | refresh          |
                          +------------------+
```

Short version of the state transition:

```text
edit -> draft saved -> review -> rejected
edit -> draft saved -> review -> approved -> compiled -> deployed -> live
```

## Contract Extraction Order

Do not implement all of these contracts first in the abstract. Instead, extract them from the first working authoring pipeline.

Recommended order:

1. Build the Svelte plugin and authoring runtime.
2. Make one WYSIWYG edit update the underlying `.svelte`.
3. Persist drafts and reload them.
4. Compile one stored `.svelte` artifact into a native web component.
5. Publish one approved draft through the deployment flow.
6. Only then formalize the contracts that proved necessary.

The first contracts to extract from the working system will likely be:

1. `EditAction`
2. `AuthoringSessionState`
3. `ArtifactRef`
4. `SourceArtifact`
5. `BuildSpec`
6. `BuildResult`
7. `PublishRequest`
8. `RunEvent`

The rest should be added when real implementation pressure makes their shape obvious.
