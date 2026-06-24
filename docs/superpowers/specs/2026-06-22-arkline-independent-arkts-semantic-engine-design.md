# ArkLine Independent ArkTS Semantic Engine Design

Date: 2026-06-22
Status: Proposed
Scope: ArkLine semantic architecture for definition, completion, hover, and symbol navigation without depending on DevEco private runtime services

## Goal

Make ArkLine's semantic IDE features independently shippable.

ArkLine must not rely on DevEco Studio's private runtime service process for core
editor intelligence. Instead, ArkLine should ship its own semantic worker and
use HarmonyOS official SDK assets, type declarations, and workspace metadata as
inputs.

The first semantic milestone must make these workflows trustworthy:

- `Ctrl+Click` / `Ctrl+B` go to definition
- `Ctrl+Space` code completion
- document symbols / outline
- hover

## Product Requirement

The target product shape is:

- user installs ArkLine
- ArkLine discovers or asks for HarmonyOS SDK path
- ArkLine starts its own semantic worker
- ArkLine uses official SDK and project metadata
- ArkLine does not require DevEco Studio to stay installed or running

This keeps the IDE product boundary clean:

- UI shell belongs to ArkLine
- semantic process belongs to ArkLine
- SDK assets belong to HarmonyOS

## Non-Goals

This design does not attempt to:

- embed DevEco private jars or private service protocols into the shipped product
- build a full custom ArkTS compiler from scratch
- reach complete IntelliJ IDEA parity in the first semantic phase
- deliver rename, implementation, code actions, or full workspace intelligence in the first cut

## Why This Direction

Using DevEco's internal `ace-server` is useful for reverse engineering and short
term validation, but it is not a viable product dependency.

Problems with depending on DevEco private services:

- version coupling to an external IDE
- startup and protocol behavior outside ArkLine's control
- packaging and support ambiguity
- brittle compatibility across DevEco releases
- user confusion about what is required for ArkLine to work

By contrast, shipping an ArkLine-owned semantic worker is the mainstream editor
architecture:

- lightweight shell process
- heavier language process
- strict protocol boundary
- clear crash recovery and restart behavior
- independent release cadence

## Recommended Architecture

ArkLine should use a four-layer model.

### Layer 1: Shell

Existing Tauri + React + CodeMirror shell remains focused on:

- editor UI
- tabs
- project tree
- overlays
- status bar
- keyboard shortcuts

The shell does not parse ArkTS semantics itself.

### Layer 2: Semantic Host

Rust in the Tauri host becomes the lifecycle owner of semantic intelligence.

Responsibilities:

- discover SDK path
- discover workspace metadata
- launch one semantic worker per workspace
- supervise process health
- forward requests and responses
- apply timeouts
- fall back safely when semantic mode is unavailable

This host is the control plane, not the semantic engine itself.

### Layer 3: ArkTS Semantic Worker

ArkLine ships a dedicated semantic worker process.

Recommended implementation:

- Node.js worker
- TypeScript codebase
- JSON-RPC or LSP-like stdio protocol

Reasons:

- ArkTS semantics are close to TypeScript ecosystems and toolchains
- HarmonyOS SDK metadata and type assets are easier to consume from Node
- it reduces time-to-value relative to full Rust semantic analysis
- it keeps the main ArkLine process lean

This worker must be ArkLine-owned and ArkLine-launched.

### Layer 4: Fallback Provider

ArkLine keeps a bounded fallback engine for no-SDK or broken-SDK environments.

Allowed fallback behaviors:

- same-file definition
- local import/export jump
- local symbol completion
- file-level symbol outline
- approximate same-workspace text usages

Fallback must remain clearly labeled and never claim semantic precision.

## Input Dependencies

The semantic worker may depend on:

- HarmonyOS SDK path
- official ArkTS / OpenHarmony declaration files
- `hvigor` project metadata
- `build-profile.json5`
- `module.json5`
- `oh-package.json5`
- local source files

The semantic worker must not depend on:

- DevEco private runtime processes
- DevEco internal Java plugin process model
- private IDE-only service bootstrap chains

## Semantic Modes

ArkLine should expose exactly three modes:

### Semantic

Real worker is healthy and using official SDK + project metadata.

Features:

- precise definition
- context-aware completion
- real hover
- real symbols

### Fallback

Worker unavailable, SDK missing, or project load incomplete.

Features:

- limited definition
- limited completion
- no fabricated hover
- simplified symbols

### Unavailable

Neither semantic nor fallback can answer meaningfully.

Behavior:

- editing remains stable
- commands degrade quietly
- status bar explains why

## Initial Feature Slice

The first independently shippable semantic milestone should include only:

1. go to definition
2. completion
3. document symbols
4. hover

This is the smallest set that materially improves ArkLine's reading workflow.

Do not include in the first slice:

- rename
- code actions
- implementation
- signature help
- full semantic usages

Those belong after the architecture is proven.

## Protocol Shape

The semantic worker interface should stay narrow and explicit.

Required requests:

- `initializeWorkspace`
- `openDocument`
- `changeDocument`
- `closeDocument`
- `gotoDefinition`
- `complete`
- `hover`
- `documentSymbols`
- `health`
- `shutdown`

All responses should include:

- `mode`
- `provider`
- `exact` vs `approximate`
- error detail when degraded

This allows the UI to remain truthful.

## Memory Strategy

Independent semantic workers are normal in the industry. The goal is not to
avoid memory entirely, but to place memory pressure in the right process and
control it deliberately.

ArkLine should use:

- one semantic worker per workspace
- incremental document updates
- bounded caches
- lazy project indexing
- import-neighborhood warmup instead of full eager indexing

Recommended cache classes:

- parsed file cache
- import graph cache
- symbol table cache
- completion context cache

Recommended limits:

- keep UI process free of semantic graph state
- cap semantic caches by file count or memory budget
- clear cold module state under pressure

This keeps the shell light while preserving low-latency navigation.

## SDK Discovery

ArkLine should support:

1. configured SDK path in settings
2. well-known install path discovery
3. user prompt when discovery fails

The product must treat SDK discovery as configuration, not as a hidden
dependency on another IDE.

Status text examples:

- `Semantic Ready`
- `Semantic Indexing`
- `Fallback`
- `SDK Missing`
- `Semantic Worker Restarting`

## Process Model

The semantic worker should be launched as a child process over stdio.

Required host behavior:

- start on workspace open
- restart once after crash
- surface crash detail in status bar and environment panel
- stop on workspace close
- isolate each workspace session

Do not multiplex multiple unrelated workspaces through one process in the first
version.

## Code Organization

To respect the repo's maintainability constraints, split this work into focused
modules.

Recommended Rust host layout:

- `src-tauri/src/services/semantic_host/manager.rs`
- `src-tauri/src/services/semantic_host/process.rs`
- `src-tauri/src/services/semantic_host/protocol.rs`
- `src-tauri/src/services/semantic_host/router.rs`
- `src-tauri/src/services/semantic/fallback_provider.rs`

Recommended worker layout:

- `semantic-worker/src/main.ts`
- `semantic-worker/src/workspace/session.ts`
- `semantic-worker/src/workspace/project-loader.ts`
- `semantic-worker/src/providers/arkts-sdk/sdk-discovery.ts`
- `semantic-worker/src/providers/arkts-sdk/definition.ts`
- `semantic-worker/src/providers/arkts-sdk/completion.ts`
- `semantic-worker/src/providers/arkts-sdk/hover.ts`
- `semantic-worker/src/providers/arkts-sdk/symbols.ts`

Keep individual files small and responsibility-focused.

## Validation Plan

Use a real HarmonyOS sample workspace.

Minimum checks:

1. open workspace
2. completion in a component body
3. `Ctrl+Click` from symbol use to definition
4. hover on component symbol
5. file outline shows expected symbols

Verification layers:

- frontend regression tests for command routing and UI state
- Rust integration tests for worker lifecycle and degraded mode
- semantic smoke tests against a real ArkTS project

## Implementation Phases

### Phase 1: Finalize Product Boundary

- stop treating DevEco private service integration as a target architecture
- keep current DevEco discovery work only as research evidence
- freeze the ArkLine-owned worker boundary

### Phase 2: Semantic Host

- add worker manager
- add request/response protocol
- add process supervision
- add health and status reporting

### Phase 3: SDK Configuration

- settings for HarmonyOS SDK path
- auto-discovery
- environment panel integration

### Phase 4: Minimal Semantic Worker

- workspace init
- document sync
- definition
- completion

### Phase 5: Reading Workflow Completion

- hover
- document symbols
- UI truthfulness and degraded-mode polish

### Phase 6: Expand Query Surface

- usages
- workspace symbols
- rename preview only after the base worker proves stable

## Recommendation

ArkLine should not ship a semantic architecture that depends on DevEco's private
runtime server.

The correct long-term architecture is:

- ArkLine-owned semantic host
- ArkLine-owned semantic worker
- official HarmonyOS SDK and project metadata as inputs
- fallback provider retained for resilience

This is the only route that satisfies all of the product constraints at once:

- independent packaging
- controllable lifecycle
- truthful semantic status
- good click-to-definition and completion UX
- maintainable engineering boundaries
