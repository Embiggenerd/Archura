# Svelte UI Builder Plugin Plan

## Table of Contents

- [Goal](#goal)
- [Product Model](#product-model)
- [High-Level System](#high-level-system)
- [Core Requirements Mapped to Implementation](#core-requirements-mapped-to-implementation)
- [1. Template Stage](#1-template-stage)
- [2. Design Stage](#2-design-stage)
- [3. Test Data / Stored Objects](#3-test-data--stored-objects)
- [4. Parallel Agent Optimization](#4-parallel-agent-optimization)
- [5. Fast Feedback Loop and Design Comparison](#5-fast-feedback-loop-and-design-comparison)
- [Technical Architecture](#technical-architecture)
- [0. Standalone Core Package](#0-standalone-core-package)
- [1. Component Registry](#1-component-registry)
- [2. File Formats and Schemas](#2-file-formats-and-schemas)
- [3. Rendering Pipeline](#3-rendering-pipeline)
- [4. Versioning Strategy](#4-versioning-strategy)
- [5. Comparison Engine](#5-comparison-engine)
- [6. Adapter Interface](#6-adapter-interface)
- [Observability Profiles](#observability-profiles)
- [Run Manager](#run-manager)
- [7. Task Routing and Multi-Provider Orchestration](#7-task-routing-and-multi-provider-orchestration)
- [8. Real-Time Server Deployment Model](#8-real-time-server-deployment-model)
- [Step-by-Step Implementation Plan](#step-by-step-implementation-plan)
- [Phase 1: Define the Contracts](#phase-1-define-the-contracts)
- [Phase 2: Build the Component Registry](#phase-2-build-the-component-registry)
- [Phase 3: Build the Template Editor](#phase-3-build-the-template-editor)
- [Phase 4: Build the Design Editor](#phase-4-build-the-design-editor)
- [Phase 5: Add Fixture Scenarios](#phase-5-add-fixture-scenarios)
- [Phase 6: Add Screenshot and Diff Testing](#phase-6-add-screenshot-and-diff-testing)
- [Phase 7: Add Agent Workflow Support](#phase-7-add-agent-workflow-support)
- [Phase 8: Add Server Runtime and Real-Time Collaboration](#phase-8-add-server-runtime-and-real-time-collaboration)
- [Phase 9: Add Review and Approval Flow](#phase-9-add-review-and-approval-flow)
- [Suggested Repo Structure](#suggested-repo-structure)
- [Recommended Data Rules](#recommended-data-rules)
- [Recommended MVP](#recommended-mvp)
- [Risks and Mitigations](#risks-and-mitigations)
- [First Build Order](#first-build-order)
- [What Success Looks Like](#what-success-looks-like)
- [Next Recommended Step](#next-recommended-step)

## Goal

Build a Svelte-based plugin that lets humans and agents create UI systems in two distinct stages:

1. **Template stage**: define structure and component composition without allowing visual styling or shape changes.
2. **Design stage**: apply visual styling, shape, spacing, color, and presentation rules to the approved template structure.

The system should also support:

- reusable test-data fixtures
- parallel agent workflows
- rapid visual comparison between implementation and a target design across multiple data states

This document breaks the work into logical implementation steps and proposes an architecture that keeps structure, style, and data clearly separated.

## Safety Principle

Agents should edit UI through constrained WYSIWYG builder artifacts rather than arbitrary source code.

The purpose of this constraint is bug prevention by construction:

- agents can change templates, designs, and fixtures
- agents cannot introduce arbitrary implementation logic
- agents operate inside validated schemas and approved editor controls
- most failures become reversible design or configuration mistakes rather than runtime code bugs

This safety model is a core reason to prefer builder-state editing over source editing.

## Product Model

Treat the system as three layers:

1. **Template layer**
   - Defines page sections, slots, component types, hierarchy, and content bindings.
   - Freezes the component inventory for later stages.
   - Example: hero, feature grid, testimonial list, footer.
   - Restriction: no arbitrary CSS, border radius, colors, typography, or spacing tokens beyond neutral layout defaults.
   - Restriction: later stages cannot add new components or delete existing ones from the template.

2. **Design layer**
   - Defines presentation tokens and component variants for a template.
   - Example: card corners, button shape, color palette, font scale, shadows, spacing density.
   - Restriction: cannot alter the semantic structure in a way that breaks the template contract.

3. **Data layer**
   - Defines test objects and scenarios used to render the template and design together.
   - Example: short title, long title, empty state, partial content, API error, validation error.

This separation is the core design choice. It makes versioning, reuse, and agent parallelism much easier.

Templates should also support domain-specific structural families. Many business domains share similar site structures, so the system should be able to reuse structural contracts across categories such as:

- moving companies
- restaurants
- home services
- clinics
- other repeated business site patterns

## High-Level System

Build the project as a provider-agnostic platform with a standalone core:

- `packages/core`
  - artifact schemas
  - validation
  - task contracts
  - run contracts
  - design/template rules
- `packages/authoring-runtime`
  - WYSIWYG editor runtime
  - browser-backed editing
  - template/design/fixture editing
  - automatic `.svelte` updates from editor changes
  - preview and verification hooks
- `packages/artifact-store`
  - template storage
  - design storage
  - fixture storage
  - generated `.svelte` persistence
  - draft and published artifact records
- `packages/agent-adapter-contract`
  - provider-neutral interfaces
  - task payload definitions
  - execution result schemas
- `packages/compiler`
  - Svelte compilation
  - web-component build output
  - build metadata
- `apps/studio`
  - visual editor UI
  - preview pane
  - design comparison tools
  - save/load/version workflow
- `apps/orchestrator`
  - run manager service
  - provider routing
  - job queue
  - collaboration/session state
- `services/deployment`
  - preview publishing
  - production publishing
  - rollback
- `adapters/`
  - `codex/`
  - `kimi/`
  - `qwen/`
  - future provider adapters

The core should be usable in three modes:

1. as a library imported by other packages
2. as a local CLI for developers and agents
3. as a server-side service that powers real-time client sessions

Provider-specific wrappers should be optional. They must depend on the core contracts rather than define them.

Plain-language role summary:

- `studio`
  - the visual editor used by humans
- `authoring runtime`
  - the live Svelte/browser editing system that updates WYSIWYG state and underlying `.svelte` together
- `provider adapter`
  - the connector that talks to a specific model provider
- `browser session`
  - the live rendered environment inside the authoring runtime that an agent can act inside
- `artifact store`
  - the system that persists templates, designs, fixtures, generated `.svelte`, and draft/published records
- `compiler`
  - the system that turns stored `.svelte` into native web components
- `run manager`
  - the backend logic that starts, tracks, and coordinates agent runs

In early versions, `apps/orchestrator` may be better understood as a `run manager` service than as a complex orchestration system.

## Core Requirements Mapped to Implementation

### 1. Template Stage

The template stage should feel like a structural editor, not a visual design tool.

The template is a hard structural contract. Its job is to decide which components exist so later stages do not need to revisit that question.

Capabilities:

- add components from an approved registry
- nest components within allowed slots
- bind content fields to named data paths
- reorder components
- save as reusable template
- define the fixed component inventory for later stages

Optional capabilities:

- define form contracts
- define input and submission expectations
- define API or feature-integration expectations when the template represents a feature instead of a simple marketing page

Restrictions:

- no color editing
- no custom CSS editing
- no typography selection
- no border/shadow/radius controls
- no freeform resizing beyond structural layout rules
- later stages cannot create new components
- later stages cannot delete components that the template defines

Implementation approach:

- represent templates as JSON or YAML documents
- define each component by schema:
  - `type`
  - `slots`
  - `props`
  - `contentBindings`
  - `layoutConstraints`
- allow optional contract extensions for features such as forms and API-backed UI flows
- store templates under version control

Template libraries should be reusable across clients, especially within the same business domain. A single domain-specific template family may serve many brands while still keeping a fixed structural contract.

Example template object:

```json
{
  "id": "marketing-landing-v1",
  "root": {
    "type": "Page",
    "slots": {
      "children": [
        {
          "type": "Hero",
          "props": { "layout": "split" },
          "contentBindings": {
            "title": "hero.title",
            "subtitle": "hero.subtitle",
            "ctaLabel": "hero.ctaLabel"
          }
        },
        {
          "type": "FeatureGrid",
          "contentBindings": {
            "items": "features"
          }
        }
      ]
    }
  }
}
```

### 2. Design Stage

The design stage should decorate the template without changing its semantic structure.

The main reason to split design into multiple stages is to reduce dimensional complexity for agents. Each stage should narrow the number of variables an agent is allowed to modify, even if that means the system requires more total decisions.

Design-stage rule:

- each stage reduces decision width by locking most variables and exposing only one coherent group of choices

This makes agent work easier to evaluate because each step has:

- allowed variables
- locked variables
- evaluation criteria
- a saved output artifact

Stages should also be configurable execution units, not fixed mandatory workflow steps.

That means a stage run should let you choose:

- whether the stage is enabled at all
- whether the stage is merged with another stage
- which part of the page it targets
- which provider or providers execute it
- which verification strategy it uses
- which observability profile it runs under

This is important because a single page may need different strategies for different subproblems. For example, a registration page might be optimized one component at a time, and a color-only decision might be evaluated using computed styles in one run and visual comparison in another.

Recommended stage-run dimensions:

- `enabledness`
  - enabled
  - skipped
  - merged with another stage
- `scope`
  - whole page
  - section
  - component instance
  - component family
  - property group such as color only
- `verification strategy`
  - computed-style
  - layout
  - structural
  - visual
  - hybrid
- `provider strategy`
  - one provider
  - multiple providers in parallel
  - human-only
  - mixed human and agent

Example configurable stage run:

```json
{
  "page": "registration",
  "target": "RegistrationForm.SubmitButton",
  "stage": "Visual Identity",
  "focus": "color",
  "enabled": true,
  "verificationStrategy": "computed-style",
  "providers": ["qwen"],
  "observabilityProfile": "debug"
}
```

The same stage can then be re-run with a different strategy:

```json
{
  "page": "registration",
  "target": "RegistrationForm.SubmitButton",
  "stage": "Visual Identity",
  "focus": "color",
  "enabled": true,
  "verificationStrategy": "visual",
  "providers": ["kimi"],
  "observabilityProfile": "showcase"
}
```

This allows the system to compare:

- one strategy versus another
- one provider versus another
- staged work versus all-in-one work
- constrained versus less constrained execution

Recommended design sub-stages:

#### 2A. Spatial Language Stage

Purpose:

- define the brand's spatial behavior without changing template semantics

Allowed variables:

- spacing rhythm
- density
- section pacing
- symmetry vs asymmetry
- alignment style
- layout variant selection within template constraints

Locked variables:

- colors
- typography styling
- decorative surfaces
- page-specific accents

Evaluation criteria:

- works across fixtures
- preserves readability
- expresses brand spatial character
- stays within template layout constraints

#### 2B. Visual Identity Stage

Purpose:

- define the core brand appearance

Allowed variables:

- color tokens
- typography tokens
- radius
- border treatment
- shadow treatment
- surface treatment

Locked variables:

- structure
- major spatial arrangement
- page-specific accents

Evaluation criteria:

- token consistency
- brand fidelity
- contrast and accessibility

#### 2C. Component Variant Stage

Purpose:

- choose how component families express the design system

Allowed variables:

- hero variant
- card variant
- button variant
- section treatment variant

Locked variables:

- global structure
- global token system
- broad spatial decisions

Evaluation criteria:

- consistency across component families
- fit with template and brand
- reuse across multiple pages

#### 2D. State Robustness Stage

Purpose:

- adapt the design to real UI states and adversarial fixtures

Allowed variables:

- long-text handling
- empty-state presentation
- error-state presentation
- loading-state presentation
- overflow handling
- mobile and dense-content adjustments

Locked variables:

- broad brand decisions
- template semantics

Evaluation criteria:

- resilience across fixtures and breakpoints
- low overflow and clipping risk
- stable comparison results

#### 2E. Page Accent Stage

Purpose:

- apply constrained page-specific emphasis after the shared system is stable

Allowed variables:

- local emphasis
- featured section treatment
- limited page-level overrides

Locked variables:

- global design language
- template semantics
- shared token foundations

Evaluation criteria:

- improves page character without causing system drift
- remains compatible with the shared design profile

Capabilities:

- define spatial language
- choose color system
- choose typography scale
- adjust component shape and variant
- adapt the design for real fixture states
- save multiple visual versions for one template

Implementation approach:

- define design profiles as staged bundles of spatial rules, tokens, variants, and state rules
- allow overrides only where a template permits them
- apply design state at render time, not by mutating the template document

Example design object:

```json
{
  "id": "marketing-soft-rounded",
  "templateId": "marketing-landing-v1",
  "tokens": {
    "color.primary": "#14532d",
    "color.surface": "#f4fff7",
    "radius.card": "24px",
    "radius.button": "999px",
    "space.section": "clamp(3rem, 6vw, 6rem)"
  },
  "variants": {
    "Hero": "editorial",
    "Button": "pill",
    "Card": "soft-shadow"
  }
}
```

### 3. Test Data / Stored Objects

Add a fixture system from the beginning. It should be a first-class concept, not an afterthought.

Fixture categories:

- nominal data
- long-text stress cases
- short/minimal content
- missing optional fields
- missing required fields
- API/network error states
- validation errors
- empty collections
- oversized collections

Implementation approach:

- define fixtures as named scenario files
- make them selectable in the editor and runnable in batch
- support inheritance so one fixture can extend another

Example fixture object:

```json
{
  "id": "hero-long-copy",
  "extends": "default-marketing",
  "data": {
    "hero": {
      "title": "A very long headline intended to test wrapping, balance, and overflow behavior across multiple responsive widths",
      "subtitle": "This is longer-than-normal support copy used to reveal clipping, awkward line lengths, and spacing regressions."
    }
  }
}
```

### 4. Parallel Agent Optimization

Design the artifact model and document formats so multiple agents can work independently.

Key rule:

- each artifact type should live in its own file tree and have a stable contract

Recommended split:

- `/templates`
- `/designs`
- `/fixtures`
- `/tokens`
- `/comparison-baselines`
- `/tasks`

Agent-friendly practices:

- keep template files separate from design files
- use schema validation to catch merge issues early
- generate task manifests from changed files
- avoid large shared config files when possible
- keep component contracts explicit and typed

Parallel work examples:

- Agent 1 refines the `Hero` template instance structure
- Agent 2 creates fixtures for hero stress cases
- Agent 3 works on token theming
- Agent 4 runs screenshot comparisons and reports diffs

### 5. Fast Feedback Loop and Design Comparison

This is where the system becomes especially useful for agent-driven UI work.

Build a preview and comparison loop with:

- live Svelte preview
- multi-scenario rendering
- responsive viewport presets
- screenshot capture
- visual diffing against a target design
- pass/fail thresholds per component or page

Recommended flow:

1. Agent edits a template artifact, design artifact, or fixture.
2. Preview updates immediately.
3. Fixture matrix renders multiple scenarios.
4. Screenshots are generated for all required states.
5. Images are compared to the target design baseline.
6. Differences are reported with links to the offending component/state.

Recommended tooling:

- SvelteKit for the studio
- Playwright for screenshot automation
- a visual diff library such as `pixelmatch`
- Zod for schema validation
- Storybook only if you want isolated component documentation in addition to the main studio

## Technical Architecture

## 0. Standalone Core Package

The core should be designed so it can become its own package and, later, its own deployable service.

Responsibilities of the core:

- own all artifact schemas
- own validation and normalization
- own template/design compatibility rules
- own task definition formats
- own execution result formats
- own comparison result formats
- expose a stable API for the studio, CLI, and adapters

The core should not know:

- which model provider is being used
- which chat product initiated a task
- how credentials are stored for each provider
- whether execution is local, queued, or remote

Recommended exports from `packages/core`:

- `loadTemplate()`
- `loadDesign()`
- `loadFixture()`
- `validateArtifact()`
- `renderScenarioInput()`
- `createTaskSpec()`
- `validateTaskResult()`
- `buildComparisonPlan()`

If you later deploy this on a server, `packages/core` can sit behind an internal API without changing its semantics. That keeps your business logic stable even if the transport changes.

## Architecture Simplification

The system should prefer a small number of integrated subsystems over many narrowly separated layers.

In particular:

- the WYSIWYG editor, live browser execution, and `.svelte` generation should be treated as one `authoring runtime`
- template/design/fixture persistence and generated `.svelte` persistence should be treated as one `artifact store`
- Svelte compilation into native web components should remain a separate `compiler` concern
- deployment should remain a separate service

This reflects the intended workflow:

1. a human or agent edits visually in the authoring runtime
2. the underlying `.svelte` updates automatically
3. preview updates immediately
4. compiled web-component output is generated from the stored `.svelte`
5. deployment publishes the latest approved version

Even within this simpler model, it is still useful to distinguish artifact types:

- WYSIWYG authoring state
- generated `.svelte` source
- compiled web-component output
- published live version

## 1. Component Registry

Create a registry of approved components instead of allowing arbitrary Svelte blocks in templates.

Each registry entry should define:

- component name
- allowed slots
- required props
- optional props
- bindable content fields
- template-stage editable fields
- design-stage editable fields
- supported variants

This gives you controlled composition and prevents the template stage from becoming an unrestricted page builder.

## 2. File Formats and Schemas

Use typed schemas for every artifact:

- `template.schema.ts`
- `design.schema.ts`
- `fixture.schema.ts`
- `component.schema.ts`
- `task.schema.ts`

Every save action should:

- validate
- normalize
- format
- write deterministically

Deterministic output matters because agents will produce cleaner diffs and fewer merge conflicts.

## 3. Rendering Pipeline

The rendering pipeline should be:

1. load template
2. validate template
3. load design
4. validate design against template contract
5. load fixture
6. resolve content bindings
7. update or regenerate the underlying `.svelte`
8. render component tree in the authoring runtime
9. inject design tokens and variants
10. mount preview

Keep rendering pure where possible so it can be reused by:

- editor preview
- screenshot tests
- batch comparisons
- agent automation

Use a URL-based preview contract so every rendered state is reproducible and shareable:

- `/preview/page/[pageId]?template=marketing-landing-v1`
- `&design=marketing-soft-rounded`
- `&fixture=hero-long-copy`
- `&viewport=mobile`

This makes it easy for humans, agents, and test runners to reference the exact same state.

## 4. Versioning Strategy

Use explicit references:

- template version
- design version
- fixture version

A page preview should always be reproducible from:

- one template
- one design
- one fixture set

Store provenance metadata:

- creator
- createdAt
- basedOn
- notes
- compatible schema version

## 5. Comparison Engine

Support two comparison modes:

1. **Design baseline comparison**
   - compare rendered output to approved screenshots

2. **Regression comparison**
   - compare current branch output to prior approved output

Outputs should include:

- diff percentage
- changed regions
- scenario name
- viewport
- affected component path

## 6. Adapter Interface

The adapter interface is the contract between your provider-agnostic system and any specific agent provider.

The key design rule is:

- adapters translate provider-specific behavior into one shared task protocol

Each adapter should implement the same logical interface:

- `listCapabilities()`
- `submitTask(taskSpec)`
- `getTaskStatus(taskRunId)`
- `cancelTask(taskRunId)`
- `streamTaskEvents(taskRunId)`
- `collectArtifacts(taskRunId)`

Each adapter should declare:

- provider name
- supported task types
- supports streaming or not
- supports artifact edits or not
- supports image input or not
- max concurrency
- retry policy
- cost metadata if available

Example provider-neutral task shape:

```json
{
  "taskId": "task-hero-mobile-fix-001",
  "kind": "layout_refinement",
  "workspaceRef": "workspace-123",
  "target": {
    "templateId": "marketing-landing-v1",
    "designId": "marketing-soft-rounded",
    "componentPath": "Page.children[0].Hero"
  },
  "inputs": {
    "fixtures": ["hero-long-copy", "hero-empty-state"],
    "viewports": ["mobile", "desktop"],
    "baselineRefs": ["baseline-hero-mobile-v3"]
  },
  "constraints": {
    "editableArtifacts": [
      "artifacts/designs/marketing-soft-rounded.json",
      "artifacts/fixtures/hero-long-copy.json"
    ],
    "lockedArtifacts": [
      "artifacts/templates/marketing-landing-v1.json"
    ]
  },
  "successCriteria": {
    "maxVisualDiffPercent": 1.5,
    "mustPassFixtures": true
  }
}
```

Example provider-neutral result shape:

```json
{
  "taskId": "task-hero-mobile-fix-001",
  "provider": "kimi",
  "status": "completed",
  "summary": "Adjusted hero layout controls and fixture coverage for mobile long-copy scenarios.",
  "changedArtifacts": [
    "artifacts/designs/marketing-soft-rounded.json",
    "artifacts/fixtures/hero-long-copy.json"
  ],
  "artifacts": {
    "screenshots": ["runs/task-hero-mobile-fix-001/mobile-long-copy.png"],
    "diffReports": ["runs/task-hero-mobile-fix-001/diff.json"]
  },
  "metrics": {
    "durationMs": 182000,
    "retryCount": 0
  }
}
```

This interface should be small and strict. The less provider-specific detail leaks into the core, the easier it will be to support more backends later.

## Browser-Backed Execution

Browser-backed execution means an agent operates against a real browser session that has loaded the builder and preview UI.

This does not mean the agent is editing source code. It means the agent is:

- opening the visual editor in a browser session
- changing builder-state artifacts through editor controls
- switching preview URLs, fixtures, or design stages
- observing the rendered result from the browser

In this model:

- artifacts are the persistent source of truth
- the browser session is the live execution environment
- the run manager coordinates providers, browser sessions, and validation

Why use browser-backed execution:

- it gives fast headless execution for agent work
- it makes rendered-state verification possible
- it allows debug observability when needed
- it creates the option to stream a live view to operators or clients

Browser-backed execution should support multiple observation modes:

- `headless mode`
  - optimized for speed
  - emits traces, task events, screenshots, and debug state
- `debug mode`
  - captures richer logs and inspection data
- `showcase mode`
  - optionally streams live video or near-live frames for human viewing

Live viewing is optional. The system should still work when no one is watching.

## Observability Profiles

Observability should be modeled as a run visibility profile layered on top of browser-backed execution. The same task pipeline can run with different levels of capture and exposure depending on the purpose of the run.

### Default Profile

Purpose:

- optimize for speed and throughput during normal operation

Characteristics:

- headless browser execution
- minimal debug observability
- lightweight run metadata
- optional final or checkpoint screenshots only

Recommended captured data:

- run id
- task type
- provider name
- start and end times
- status transitions
- changed artifacts
- validation results

Best for:

- routine production runs
- low-risk agent tasks
- high-throughput workflows

### Debug Profile

Purpose:

- help developers and operators understand how a run behaved

Characteristics:

- still usually headless
- richer traces and event logs
- more intermediate inspection data
- intended for diagnosis, evaluation, and workflow tuning

Recommended captured data:

- detailed task timeline
- builder actions
- artifact checkpoints
- intermediate screenshots
- preview URL changes
- fixture switches
- validation results at multiple checkpoints
- constraint mode changes

Best for:

- failed runs
- provider evaluation
- prompt and policy tuning
- regression investigation

### Showcase Profile

Purpose:

- make the run understandable and impressive to human viewers

Characteristics:

- optional live video stream or near-live playback
- simplified presentation layer
- selective event visibility instead of raw debug noise
- suitable for clients, demos, and marketing

Recommended visible data:

- current task
- live or near-live preview
- simple progress status
- before and after comparison
- curated event feed

Best for:

- client-facing sessions
- sales demos
- internal presentations
- optional trust-building moments during active work

Design rule:

- observability profiles should not create separate execution systems
- they should be configuration layers over the same run model

Each profile should define:

- capture frequency
- screenshot cadence
- whether live streaming is enabled
- whether intermediate artifacts are stored
- log retention policy
- which viewer roles can access the run

Observability should be selectable per stage run, not only per full page run. This makes it possible to watch or debug a narrow task such as a single color decision on one registration-form component.

## Run Manager

The run manager is normal backend application logic that coordinates a single agent run or a group of related runs.

It is not:

- an LLM session
- a provider model
- the browser itself

It is the system layer that answers questions like:

- what task was requested
- which provider should handle it
- which browser session should be used
- which artifacts are editable
- which constraint mode is active
- which checks run afterward
- whether the run should expose debug data or a live stream

In small versions of the system, the run manager can begin as:

- a script
- a server route plus job worker
- a thin backend service

In larger versions, it can grow into:

- a dedicated run service
- a browser-session manager
- a provider router
- a telemetry and event-stream producer

## 7. Task Routing and Multi-Provider Orchestration

You want clients to work in real time with one provider while other providers handle background construction tasks. That means you need a coordination layer, here called the run manager or orchestrator, not just a plugin wrapper.

Suggested server responsibilities:

- maintain user sessions
- persist artifacts and run history
- accept task requests from the studio
- route tasks to the correct provider adapter
- stream progress back to clients
- enforce workspace and artifact-scope permissions
- queue long-running jobs

The main purpose of this layer is coordination, not live streaming. Live streaming is optional and can be enabled only for runs where human observation is useful.

A useful routing model is:

- **interactive chat provider**
  - handles direct user conversation in the studio
  - example: Codex
- **execution providers**
  - handle scoped template/design/fixture tasks
  - example: Kimi or Qwen
- **review provider**
  - optionally validates or critiques work from another provider

Example routing policy:

- user conversation and planning -> Codex adapter
- template and layout refinement -> Qwen adapter
- design-variant exploration -> Kimi adapter
- screenshot review and regression diagnosis -> whichever provider performs best on evaluation tasks

The orchestrator should choose providers based on:

- task kind
- artifact ownership
- cost target
- latency target
- current provider load
- historical success rate for similar tasks

Recommended task kinds:

- `template_creation`
- `design_variant_generation`
- `fixture_generation`
- `layout_refinement`
- `visual_regression_fix`
- `copy_population`
- `qa_review`
- `design_to_render_alignment`

## 8. Real-Time Server Deployment Model

To support clients building websites in real time, separate the system into request/response and background execution layers.

Recommended runtime pieces:

- `studio web app`
  - browser UI for clients
- `orchestrator API`
  - session management
  - artifact read/write
  - task submission
  - websocket/SSE updates
- `job queue`
  - async provider tasks
- `worker pool`
  - runs comparison jobs, screenshot generation, and adapter calls
- `artifact store`
  - templates, designs, fixtures, baselines, run logs

Typical real-time flow:

1. Client edits a template or design in the studio.
2. The studio saves through the orchestrator API.
3. The client asks for a change such as "make this hero cleaner on mobile."
4. The orchestrator turns that request into one or more `taskSpec` objects.
5. The routing layer assigns those tasks to Codex, Kimi, Qwen, or another provider based on policy.
6. Workers run the tasks and stream back progress.
7. The orchestrator validates results, runs screenshot comparisons, and publishes updates to the client.
8. The client sees proposed changes, diffs, and approval controls in real time.

This model gives you a clean separation between:

- human collaboration
- provider selection
- execution
- validation
- approval

## Step-by-Step Implementation Plan

## Phase 1: Define the Contracts

Goal: lock down the separation between structure, style, and data.

Steps:

1. Define the artifact types: template, design, fixture, task, baseline.
2. Write TypeScript types and Zod schemas for each.
3. Define the component registry contract.
4. Decide how content bindings map fixture data into components.
5. Define rules for what is editable in template stage vs design stage.

Deliverables:

- schema package
- validation utilities
- example artifact files

## Phase 2: Build the Component Registry

Goal: make composition controlled and reusable.

Steps:

1. Create a small starter set of components:
   - Page
   - Section
   - Hero
   - FeatureGrid
   - Card
   - TestimonialList
   - CTA
   - Footer
2. Define slots and bindable props for each.
3. Wrap each component with metadata consumed by the editor.
4. Expose a registry API the studio can query.

Deliverables:

- component registry definitions
- starter registered components
- metadata definitions

## Phase 3: Build the Template Editor

Goal: allow users and agents to define page structure only.

Steps:

1. Create a tree editor for component hierarchy.
2. Add controls to insert, remove, and reorder components.
3. Add binding controls for content fields.
4. Enforce template-stage restrictions in the UI and schema.
5. Add save/load for template documents.

Important constraint:

The template editor should never expose direct style controls.

Deliverables:

- structure editor UI
- template serializer
- template validation errors in UI

## Phase 4: Build the Design Editor

Goal: allow controlled visual customization on top of a template while limiting decision width per stage.

Steps:

1. Build a `Spatial Language` stage for spacing rhythm, density, alignment style, and layout variants within template constraints.
2. Build a `Visual Identity` stage for color, typography, radius, border, shadow, and surface rules.
3. Build a `Component Variant` stage for choosing component-family variants.
4. Build a `State Robustness` stage for long-text, error, empty, loading, and dense-content adjustments.
5. Build a `Page Accent` stage for constrained page-level emphasis and local overrides.
6. Save each design stage output as part of the overall design profile.
7. Render live changes against the selected template and fixture set.

Deliverables:

- spatial language editor
- visual identity editor
- variant editor
- state robustness editor
- page accent editor
- design save/load workflow

## Phase 5: Add Fixture Scenarios

Goal: make UI testing realistic and repeatable.

Steps:

1. Create the fixture schema and storage format.
2. Build a scenario picker in the studio.
3. Support fixture inheritance and grouped scenario sets.
4. Add quick presets for:
   - short copy
   - long copy
   - empty state
   - error state
   - dense list
5. Render the selected page against one or many fixtures.

Deliverables:

- fixture library
- scenario runner
- fixture switcher UI

## Phase 6: Add Screenshot and Diff Testing

Goal: create the fast feedback loop for both humans and agents.

Steps:

1. Use Playwright to render target routes or preview states.
2. Capture screenshots for each fixture and viewport.
3. Compare against stored baselines.
4. Generate visual diff artifacts.
5. Surface failures in the studio and CI output.

Deliverables:

- screenshot runner
- baseline storage
- diff reports

## Phase 7: Add Agent Workflow Support

Goal: make parallel work safe and efficient.

Steps:

1. Add provider-neutral task manifests that point to specific artifacts.
2. Define an adapter interface package with shared request/result schemas.
3. Add provider adapters for the first supported backends.
4. Generate tasks from desired outcomes, such as:
   - create a new landing page template
   - adapt design for a healthcare brand
   - improve mobile layout for long-text fixture
5. Add routing rules for which provider handles which task type.
6. Add validation commands agents can run locally.
7. Add comparison commands agents can run before submitting changes.
8. Keep outputs machine-readable where possible.

Recommended commands:

- `validate:templates`
- `validate:designs`
- `validate:fixtures`
- `tasks:create`
- `tasks:route`
- `tasks:run`
- `tasks:status`
- `preview:url`
- `compare:baseline`
- `compare:changed`

Deliverables:

- agent task files
- adapter contract package
- provider adapters
- orchestrator routing rules
- CLI scripts
- documented workflow for parallel contributions

## Phase 8: Add Server Runtime and Real-Time Collaboration

Goal: let clients build sites in real time while background agents work across providers.

Steps:

1. Build an orchestrator API for artifact read/write and task submission.
2. Add websocket or SSE streaming for live updates.
3. Add a queue for long-running jobs.
4. Add worker processes for provider tasks and screenshot comparisons.
5. Add tenant/workspace isolation and artifact-scope permissions.
6. Store task runs, logs, artifacts, and approvals for replay and auditing.

Deliverables:

- orchestrator service
- event stream layer
- job queue integration
- run history model

## Phase 9: Add Review and Approval Flow

Goal: move artifacts from draft to approved state.

Steps:

1. Add statuses such as `draft`, `review`, `approved`, `archived`.
2. Require screenshot approval for key scenarios before promotion.
3. Track what changed between versions.
4. Allow a design to fork from an approved prior design.

Deliverables:

- status workflow
- approval metadata
- artifact history view

## Suggested Repo Structure

```text
packages/
  core/
  authoring-runtime/
  artifact-store/
  agent-adapter-contract/
  compiler/
apps/
  studio/
  orchestrator/
services/
  deployment/
adapters/
  codex/
  kimi/
  qwen/
artifacts/
  templates/
  designs/
  fixtures/
  baselines/
  tasks/
registry/
  primitives/
  composites/
scripts/
  validate/
  tasks/
  compare/
  capture/
```

## Recommended Data Rules

To keep the system maintainable:

- templates must not contain raw style values
- designs must not mutate component hierarchy
- fixtures must be reusable across multiple templates when possible
- components should declare which props are structural vs visual
- every saved artifact should validate before write
- every comparison run should specify template, design, fixture, and viewport
- every task run should record provider, inputs, outputs, and validation status
- adapters must only receive provider-neutral task specs, not raw editor state
- fixture selection should be representable in preview URLs and persisted run metadata

## Recommended MVP

Start with a narrow MVP:

- one page type: marketing landing page
- 6 to 8 components
- 3 template examples
- 3 design variants
- 6 fixture scenarios
- 2 provider adapters
- screenshot comparison for desktop and mobile
- one orchestrator route for background tasks

This is enough to prove:

- the two-stage model works
- templates are reusable
- designs can vary without breaking structure
- fixtures catch layout issues
- agents can work in parallel with low conflict
- providers can be swapped without changing the core

## Risks and Mitigations

### Risk: Template and design boundaries blur

Mitigation:

- enforce edit permissions in schema and UI
- separate files and save flows

### Risk: Components become too flexible and hard to validate

Mitigation:

- use a constrained component registry
- avoid arbitrary user-authored component code in templates

### Risk: Agent merge conflicts

Mitigation:

- deterministic file formatting
- one artifact per file
- task manifests with clear ownership

### Risk: Provider lock-in leaks into the core

Mitigation:

- keep provider-specific logic inside adapters only
- define all tasks and results in provider-neutral schemas
- force all providers through the same orchestration contract

### Risk: Real-time server complexity grows too early

Mitigation:

- keep the first orchestrator thin
- start with one queue and a small worker pool
- build server APIs on top of the same core package used locally

### Risk: Visual diffs are noisy

Mitigation:

- use stable fonts and rendering environment
- compare per scenario and viewport
- set component-level thresholds where needed

## First Build Order

If you want the fastest path to a working prototype, build in this order:

1. Svelte plugin and authoring runtime
2. One editable component/template flow that updates underlying `.svelte`
3. Draft save/load persistence
4. Compile stored `.svelte` into a native web component
5. Preview and publish flow
6. Fixture switching
7. Template and design stage restrictions
8. Verification strategies
9. Extract contracts and service boundaries from the working pipeline
10. Add provider adapters and run manager coordination

## What Success Looks Like

A successful version of this plugin will let someone:

1. create a site template without worrying about styling
2. create multiple branded visual systems from that same template
3. preview the result with realistic and adversarial data
4. let multiple agents work on separate parts of the system in parallel
5. assign different task types to different providers without changing the core
6. quickly compare output against a target design and catch regressions early
7. run the system as a real-time service for clients building websites collaboratively

## Next Recommended Step

The best next move is to implement the **Svelte plugin and authoring runtime first**, then prove one real end-to-end loop:

1. edit visually
2. update underlying `.svelte`
3. save draft
4. preview
5. compile to native web component
6. publish

Once that loop is working, extract the contracts and service boundaries from the real data flow instead of guessing them up front.
