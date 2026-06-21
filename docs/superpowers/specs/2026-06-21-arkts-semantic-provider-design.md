# ArkLine ArkTS Semantic Provider Design

Date: 2026-06-21
Status: Proposed
Scope: First semantic IDE milestone for ArkLine

## Goal

Bring ArkLine's ArkTS editor experience closer to IDEA-level semantic workflows
for:

- Go to Definition
- Auto Completion
- Hover
- Document Symbols
- Find Usages

This milestone must support two execution modes:

1. `semantic`: real ArkTS SDK / language-service-backed results
2. `fallback`: weak but honest local results when no SDK is available

The architecture must prioritize a correct provider boundary and mode switching
before expanding feature breadth.

## Non-Goals

This milestone does not include:

- semantic rename
- signature help
- find implementation
- code actions / quick fix
- peek definition
- full IDEA parity in symbol resolution depth

It also does not attempt to fake real semantic precision when the SDK is not
available.

## User Requirements Confirmed

- Primary path must use the real ArkTS SDK / language service
- No-SDK environments must still work, but only through clearly labeled weak
  fallback behavior
- The UI must distinguish real semantic mode from weak semantic mode
- The first delivery must prioritize architecture and mode separation over
  shallow feature count

## Recommended Architecture

ArkLine should adopt a dual-provider semantic layer.

### Core Model

Add a unified semantic abstraction between the editor shell and all symbol-aware
operations:

- `SemanticProvider`
- `SemanticRouter`
- `SemanticMode`

`SemanticMode` values:

- `semantic`
- `fallback`
- `unavailable`

The frontend should only call one semantic API surface. It must not own
provider-specific logic.

### Rust Host Structure

Introduce a provider boundary in the Tauri host:

- `SemanticProvider` trait
- `ArkTsLspProvider`
- `FallbackProvider`
- `SemanticRouter`

Responsibilities:

- `ArkTsLspProvider`
  - discover configured SDK / language-service entrypoint
  - start and supervise the ArkTS semantic process
  - perform real requests for definition, completion, hover, symbols, and usages
  - report health and capability state

- `FallbackProvider`
  - serve local weak semantic results without requiring the SDK
  - reuse and consolidate current same-file / import-based logic
  - provide deterministic and bounded degraded behavior

- `SemanticRouter`
  - choose the active provider
  - expose current semantic mode
  - downgrade to fallback when the real provider is unavailable or unhealthy
  - prevent provider-specific branching from leaking into command handlers

### Frontend Structure

Frontend should gain a semantic state surface:

- `semantic-store.ts`
- `semantic-mode-badge.tsx`
- `semantic-actions.ts`

Responsibilities:

- store active semantic mode and provider capabilities
- route editor actions through one semantic interface
- display capability truthfully in status UI
- avoid duplicating "semantic vs fallback" conditions inside `AppShell`

## Mode Behavior

### Real Semantic Mode

When the SDK-backed provider is healthy:

- definition uses precise ArkTS semantic results
- completion uses context-aware semantic completion
- hover shows semantic documentation / symbol detail
- document symbols use real document symbol data
- usages use semantic references

This is the only mode that can claim IDEA-like symbol trust.

### Fallback Mode

Fallback mode must be useful, but explicitly approximate.

Allowed fallback behaviors:

- same-file definition jumps
- relative import cross-file definition jumps
- local export/import resolution
- file-local and nearby-symbol completion
- file-level symbol outline
- approximate usages from local workspace indexing

Fallback mode must not pretend to provide:

- type-driven completion
- precise semantic references
- deep framework-aware ArkTS analysis
- rename-quality symbol tracking

If hover content is unavailable, return no hover instead of fabricated detail.

### Unavailable Mode

If neither provider can answer:

- show `Unavailable`
- keep editor stable
- do not block editing
- surface clear but quiet status text

## UI and Interaction Rules

ArkLine must visibly expose the active semantic mode in the status bar.

Recommended labels:

- `ArkTS Semantic`
- `Fallback`
- `Unavailable`

Interaction behavior:

- Definition
  - semantic mode: jump directly
  - fallback mode: jump and label result as fallback where appropriate

- Completion
  - semantic mode: normal completion popup
  - fallback mode: limited popup with local symbols / imports / keywords

- Hover
  - semantic mode: semantic detail
  - fallback mode: only local declaration summary when available

- Document Symbols
  - semantic mode: full symbol model
  - fallback mode: simplified parsed outline

- Find Usages
  - semantic mode: semantic references
  - fallback mode: approximate local index results, clearly marked

Add a user-triggered action:

- `Retry Semantic Service`

This allows manual recovery without restarting the application.

## API Surface

The unified semantic interface should cover:

- `inspectSemanticProvider`
- `gotoDefinition`
- `completeSymbol`
- `hoverSymbol`
- `documentSymbols`
- `findUsages`

Each result should include enough metadata to distinguish:

- active mode
- provider name
- exact vs approximate semantics

This metadata is required for trustworthy UI messaging and regression coverage.

## Implementation Order

### Phase 1: Provider Boundary

1. add `SemanticProvider` trait
2. add `SemanticRouter`
3. move current definition/completion local logic into `FallbackProvider`
4. introduce semantic mode reporting

### Phase 2: Complete Fallback Provider

1. strengthen fallback definition behavior
2. add fallback hover
3. add fallback document symbols
4. add fallback usages
5. keep results approximate and bounded

### Phase 3: ArkTS LSP Provider Skeleton

1. SDK / process discovery
2. provider health model
3. lifecycle supervision
4. request plumbing for the five target capabilities

### Phase 4: Real Semantic Path

1. wire definition
2. wire completion
3. wire hover
4. wire document symbols
5. wire usages

### Phase 5: UI Exposure

1. status bar mode badge
2. fallback labeling
3. retry action
4. failure-state messaging

### Phase 6: Real Project Validation

Use a real small HarmonyOS / ArkTS sample workspace to validate:

1. completion inside component bodies
2. click / shortcut definition jumps
3. hover on symbols
4. symbol outline for active file
5. usages across multiple files

## File and Boundary Guidance

No single implementation file should grow past the project's 500-line guardrail.

Prefer focused modules:

- one provider per file group
- one semantic state module
- one semantic result model module
- one UI module per visible semantic surface

Do not keep growing `AppShell.tsx` with semantic conditionals.

## Verification Strategy

### Automated Frontend Tests

Cover:

- mode badge rendering
- action routing through unified semantic API
- fallback result labeling
- completion popup behavior by mode

### Automated Backend Tests

Cover:

- provider selection
- fallback provider correctness on fixture workspaces
- unhealthy semantic provider downgrade
- SDK-unavailable startup path

### Manual Real-SDK Smoke

Required before claiming completion:

1. open a real ArkTS sample project
2. verify definition from symbol use to declaration
3. verify completion in live editing context
4. verify hover details
5. verify document symbols
6. verify usages across files

## Definition of Done

This milestone is complete only when all are true:

1. `SemanticProvider` / `SemanticRouter` boundary is in place
2. ArkLine exposes `semantic`, `fallback`, and `unavailable` modes truthfully
3. fallback mode works without SDK and does not misrepresent precision
4. real SDK mode supports definition, completion, hover, document symbols, and
   usages on a real ArkTS sample workspace
5. frontend and backend verification exists for claimed capabilities

## Recommendation

Proceed with the dual-provider architecture.

This is the smallest design that preserves trust, supports no-SDK development
machines, and gives ArkLine a stable base for future IDEA-like semantic features.
