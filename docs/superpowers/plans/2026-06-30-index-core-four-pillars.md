# Index Core Four Pillars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the four missing IDE-grade index foundations: syntax/stub indexing, dependency-driven invalidation, generation-consistent query behavior, and explainable missing-result diagnostics.

**Architecture:** Keep the current SQLite-backed index, worker, task journal, SDK index, and query facade. Add focused services around those foundations instead of expanding `WorkspaceIndexRuntime`: an ArkTS stub parser, a dependency graph service, a query consistency/readiness service, and an explain diagnostics service. UI and commands ask facades for results and explanations; they do not inspect raw index tables.

**Tech Stack:** Rust/Tauri backend, SQLite, existing workspace index services, React/Vitest frontend, existing semantic worker as optional semantic provider.

---

## Current Baseline

Already implemented:

- Background index manager, scheduler, worker wake loop, terminal task statuses, task journal.
- SQLite schema versions, file fingerprints, content rows, FTS content search, symbol entities, SDK/API entities.
- Query facade for quick open, Search Everywhere scopes, file symbols, content search.
- Indexed completion provider with language-service, file-index, workspace-index, SDK/API, and keyword fallback.
- Diagnostics count surface, rebuild/clear maintenance commands.

Still missing:

- Parser-quality ArkTS stub index for declarations, scopes, imports, exports, decorators, and member metadata.
- Dependency graph that invalidates affected files when imports/exports/config/SDK change.
- Generation-pinned query contract so UI knows whether a result is ready, partial, stale, or blocked.
- Explain-missing-result diagnostics for search, jump, symbols, completion, and SDK/API lookup.

## Target File Boundaries

Create:

- `src-tauri/src/services/workspace_arkts_stub_parser_service.rs`
  - Parse one ArkTS/ETS/TS source file into declaration/import/export stubs.
- `src-tauri/src/services/workspace_stub_index_service.rs`
  - Persist and query project stub entities derived from source files.
- `src-tauri/src/services/workspace_dependency_graph_service.rs`
  - Persist import/export edges and compute affected files for changed paths.
- `src-tauri/src/services/workspace_index_readiness_service.rs`
  - Own query freshness/readiness decisions and generation-pinned query metadata.
- `src-tauri/src/services/workspace_index_explain_service.rs`
  - Explain why a query, definition, symbol, API, or completion candidate is missing.

Modify:

- `src-tauri/src/services/workspace_index_schema_service.rs`
  - Add schema tables for stubs, dependency graph, query generations, parser errors, explain facts.
- `src-tauri/src/services/workspace_index_service.rs`
  - Route changed-file indexing through stub and dependency graph services.
- `src-tauri/src/services/workspace_index_worker_service.rs`
  - Use dependency graph expansion for changed-path tasks.
- `src-tauri/src/services/workspace_index_query_service.rs`
  - Attach readiness/freshness metadata and consume stub entities.
- `src-tauri/src/services/workspace_index_entity_query_service.rs`
  - Prefer stub-backed entities when available.
- `src-tauri/src/commands/workspace.rs`
  - Expose explain/readiness commands.
- `src-tauri/src/models/workspace.rs`
  - Add models for stubs, dependency edges, query readiness, and explain result.
- `src/features/workspace/workspace-api.ts`
  - Add frontend types and invoke wrappers.
- `src/features/workspace/workspace-index-store.ts`
  - Track query readiness and explain diagnostics.
- `src/components/layout/AppShell.tsx`
  - Show blocked/partial/explainable states through existing search/completion/jump flows without adding more direct fallback logic.

Guardrails:

- New Rust files must stay under 500 lines.
- Existing oversized frontend files should only receive thin wiring; new logic belongs in focused model/provider files.
- Each phase must be independently shippable and tested.

---

## Phase 1: Generation-Pinned Query Readiness

**Purpose:** Make every index-backed query report whether it came from the current generation, a stale generation, a partial index, or a blocked dependency.

### Task 1: Add Readiness Models

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Create: `src-tauri/src/services/workspace_index_readiness_service.rs`
- Test: `src-tauri/src/services/workspace_index_readiness_service_tests.rs`

- [x] Add `WorkspaceIndexReadiness` with fields:
  - `root_path: String`
  - `requested_generation: u64`
  - `served_generation: Option<u64>`
  - `state: "ready" | "partial" | "stale" | "blocked" | "missing"`
  - `reason: Option<String>`
  - `retryable: bool`
- [x] Add `WorkspaceIndexQueryEnvelope<T>` with `items: Vec<T>` and `readiness: WorkspaceIndexReadiness`.
- [x] Implement `readiness_for_query(root_path, required_generation, served_generation, partial_reason)` in `workspace_index_readiness_service.rs`.
- [x] Test:
  - current generation returns `ready`.
  - older served generation returns `stale`.
  - partial reason returns `partial`.
  - missing served generation returns `missing`.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_readiness_service_tests
```

Expected: readiness unit tests pass.

### Task 2: Envelope Search Everywhere and File Symbol Queries

**Files:**
- Modify: `src-tauri/src/services/workspace_index_query_service.rs`
- Modify: `src-tauri/src/services/workspace_index_entity_query_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `src-tauri/src/services/workspace_index_query_service_tests.rs`
- Test: `tests/frontend/workspace-index-store.test.ts`

- [x] Add envelope-returning backend functions:
  - `query_workspace_candidates_with_readiness(root_path, query, scope, limit)`
  - `query_workspace_file_symbols_with_readiness(root_path, file_path, query, limit)`
- [x] Keep existing non-envelope commands as compatibility wrappers returning only `items`.
- [x] Add TypeScript types:
  - `WorkspaceIndexReadiness`
  - `WorkspaceIndexQueryEnvelope<T>`
- [x] Add `WorkspaceApi` methods:
  - `queryWorkspaceCandidatesWithReadiness`
  - `queryWorkspaceFileSymbolsWithReadiness`
- [x] Test backend ready/stale envelope metadata.
- [x] Test frontend store preserves `partial` and `stale` readiness.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests
pnpm exec vitest run tests/frontend/workspace-index-store.test.ts
pnpm build
```

Expected: existing query behavior remains compatible while new envelope APIs expose readiness.

---

## Phase 2: Explain-Missing-Result Diagnostics

**Purpose:** Give users and developers a concrete answer for “why did search/jump/completion not find this?”

### Task 3: Add Explain Result Model and Service

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Create: `src-tauri/src/services/workspace_index_explain_service.rs`
- Create: `src-tauri/src/services/workspace_index_explain_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add `WorkspaceIndexExplainRequest`:
  - `root_path`
  - `kind: "search" | "definition" | "symbol" | "completion" | "api"`
  - `query`
  - `path: Option<String>`
  - `line: Option<u32>`
  - `column: Option<u32>`
- [x] Add `WorkspaceIndexExplainResult`:
  - `status: "found" | "notIndexed" | "excluded" | "stale" | "partial" | "sdkNotReady" | "parserFailed" | "unsupported"`.
  - `message`
  - `facts: Vec<WorkspaceIndexExplainFact>`.
  - `recommended_action: Option<"wait" | "rebuildIndex" | "configureSdk" | "openFile" | "reportBug">`.
- [x] Implement checks in this order:
  - excluded path policy.
  - file fingerprint exists.
  - content/symbol/entity rows exist for path.
  - active SDK metadata exists for API queries.
  - parser error exists for path.
  - latest task failure exists for root.
- [x] Tests:
  - excluded path explains `excluded`.
  - missing fingerprint explains `notIndexed`.
  - SDK API query without active SDK explains `sdkNotReady`.
  - parser error explains `parserFailed`.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_explain_service_tests
```

Expected: explain results are deterministic and action-oriented.

### Task 4: Expose Explain Command and UI Hook

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Create: `src/features/workspace/index-explain-model.ts`
- Test: `tests/frontend/workspace-api.test.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] Add Tauri command `explain_workspace_index_query`.
- [x] Add `WorkspaceApi.explainWorkspaceIndexQuery(request)`.
- [x] Add `formatIndexExplainMessage(result)` in `index-explain-model.ts`.
- [x] Wire failed Search Everywhere, empty global search, and failed Ctrl+Click to store the latest explain result in status/debug text.
- [x] Test formatting for `excluded`, `sdkNotReady`, and `parserFailed`.
- [x] Test failed Ctrl+Click can show an explain message instead of only “no target”.

Run:

```bash
pnpm exec vitest run tests/frontend/workspace-api.test.ts tests/frontend/app-shell.test.tsx --testNamePattern "explain|Ctrl\\+Click"
pnpm build
```

Expected: users get a concrete reason and action when indexed lookup misses.

---

## Phase 3: ArkTS Stub Index Foundation

**Purpose:** Replace fragile symbol extraction with a declaration-oriented stub index that can power Search Everywhere, completion, jump, rename, and usages.

### Task 5: Stub Parser Data Model

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Create: `src-tauri/src/services/workspace_arkts_stub_parser_service.rs`
- Create: `src-tauri/src/services/workspace_arkts_stub_parser_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add `ArkTsFileStub`:
  - `path`
  - `module_name: Option<String>`
  - `imports: Vec<ArkTsImportStub>`
  - `exports: Vec<ArkTsExportStub>`
  - `declarations: Vec<ArkTsDeclarationStub>`
  - `parse_errors: Vec<ArkTsParseError>`
- [x] Add declaration fields:
  - `kind`
  - `name`
  - `qualified_name`
  - `container`
  - `visibility`
  - `modifiers`
  - `signature`
  - `line`
  - `column`
  - `end_line`
  - `end_column`
- [x] Parser must handle:
  - `struct Index { build() {} }`
  - `class UserService { private async loadUser(id: string) {} }`
  - `export class Foo`
  - `export default struct Main`
  - `import { Foo as Bar } from "./foo"`
  - decorators like `@Entry`, `@Component`, `@Builder`.
- [x] Tests:
  - class/struct/function/method/property stubs.
  - visibility and modifier parsing.
  - import/export alias parsing.
  - decorator stubs on declarations.
  - malformed source records parse error without panicking.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_arkts_stub_parser_service_tests
```

Expected: parser creates stable stubs from representative ArkTS files.

### Task 6: Stub Tables and Persistence

**Files:**
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Create: `src-tauri/src/services/workspace_stub_index_service.rs`
- Create: `src-tauri/src/services/workspace_stub_index_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_service.rs`

- [x] Add tables:
  - `workspace_stub_files(root_path, path, parser_version, indexed_generation, parse_status, error_count)`.
  - `workspace_stub_declarations(root_path, path, entity_id, kind, name, qualified_name, container, visibility, signature, line, column, end_line, end_column, modifiers_json, decorators_json)`.
  - `workspace_stub_imports(root_path, path, source_module, imported_name, local_name, is_type_only, line, column)`.
  - `workspace_stub_exports(root_path, path, exported_name, local_name, source_module, is_default, line, column)`.
  - `workspace_stub_parse_errors(root_path, path, message, line, column)`.
- [x] Persist stubs for changed files in one transaction with symbol entity updates.
- [x] Delete stub rows for removed files.
- [x] Store parser version in schema/fingerprint metadata.
- [x] Tests:
  - full refresh writes declarations/imports/exports.
  - changed file replaces only its stub rows.
  - deleted file removes stub rows.
  - parser error persists and does not block other files.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_stub_index_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_service_tests
```

Expected: stubs are durable and incremental.

### Task 7: Query Facade Uses Stub Declarations

**Files:**
- Modify: `src-tauri/src/services/workspace_index_entity_query_service.rs`
- Modify: `src-tauri/src/services/workspace_index_query_service.rs`
- Test: `src-tauri/src/services/workspace_index_entity_query_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_query_service_tests.rs`

- [x] Prefer `workspace_stub_declarations` for project symbols when parser version is current.
- [x] Fall back to `workspace_symbol_entities` when stubs are missing.
- [x] Include declaration metadata in `WorkspaceSearchCandidate.subtitle`:
  - `Container · relative/path:line`.
- [x] Keep SDK/API candidates separate from project stubs.
- [x] Tests:
  - Search Everywhere class tab returns stub class.
  - Symbols tab returns stub methods with containers.
  - file symbols return source-order declarations.
  - legacy entity fallback still works.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_entity_query_service_tests workspace_index_query_service_tests
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Search Everywhere|Ctrl\\+F7|completion"
```

Expected: project symbol queries become stub-backed without losing legacy behavior.

---

## Phase 4: Dependency Graph and Invalidation

**Purpose:** Reindex not only directly changed files, but also files whose imported/exported symbol view depends on changed files.

### Task 8: Dependency Graph Tables and Resolver

**Files:**
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Create: `src-tauri/src/services/workspace_dependency_graph_service.rs`
- Create: `src-tauri/src/services/workspace_dependency_graph_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add tables:
  - `workspace_dependency_edges(root_path, from_path, to_path, source_module, kind, line, column)`.
  - `workspace_dependency_reverse(root_path, to_path, from_path)`.
  - `workspace_unresolved_imports(root_path, from_path, source_module, line, column)`.
- [x] Resolve relative imports:
  - `./foo`
  - `./foo.ets`
  - `../model/User`
  - directory `index.ets` if present.
- [x] Persist unresolved imports separately.
- [x] Tests:
  - relative import resolves to target path.
  - alias import still produces dependency edge.
  - missing target produces unresolved import.
  - reverse dependency query returns importers.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_dependency_graph_service_tests
```

Expected: direct and reverse dependency edges are queryable.

### Task 9: Changed-Path Expansion

**Files:**
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_index_service.rs`
- Test: `src-tauri/src/services/workspace_index_worker_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_service_tests.rs`

- [x] For changed-path tasks, expand affected files:
  - include changed files.
  - include direct reverse dependencies.
  - include re-export dependents.
  - cap expansion at `INDEX_DEPENDENCY_EXPANSION_LIMIT = 500`.
- [x] If cap is exceeded, schedule/perform a full refresh and mark readiness `partial` until done.
- [x] Update fingerprints for both directly changed and affected reindexed files.
- [x] Tests:
  - changing `model/User.ets` reindexes `pages/Profile.ets` that imports it.
  - deleting imported file records unresolved import and reindexes importer.
  - dependency expansion cap falls back to full refresh.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_worker_service_tests workspace_index_service_tests
```

Expected: dependent symbol/completion queries update after dependency changes.

### Task 10: Config and SDK Dependency Invalidations

**Files:**
- Modify: `src-tauri/src/services/workspace_dependency_graph_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Test: `src-tauri/src/services/workspace_dependency_graph_service_tests.rs`
- Test: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Treat these files as graph-affecting config roots:
  - `oh-package.json5`
  - `build-profile.json5`
  - `hvigorfile.ts`
  - `tsconfig.json`
  - `module.json5`
- [x] When config root changes, invalidate dependency graph and schedule refresh with reason `config-change`.
- [x] When active SDK path/version changes, invalidate SDK/API readiness and stale API candidates.
- [x] Tests:
  - config change marks dependency graph stale.
  - SDK switch clears stale API candidates and exposes only active SDK.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_dependency_graph_service_tests workspace_sdk_index_service_tests
```

Expected: config/SDK changes no longer leave old query results silently active.

---

## Phase 5: Unified Definition, Usages, and Completion Calls

**Purpose:** Make jump, usages, current-class methods, Search Everywhere, and completion consume the same readiness-aware stub/query infrastructure.

### Task 11: Definition Query Facade

**Files:**
- Modify: `src-tauri/src/services/workspace_index_query_service.rs`
- Modify: `src-tauri/src/services/language_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Test: `src-tauri/src/services/workspace_index_query_service_tests.rs`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] Add `query_definition_candidates(root_path, request)`:
  - semantic language service first when ready.
  - stub import/export resolution second.
  - SDK/API active index third.
  - same-file fallback last.
- [x] Return envelope with readiness and candidate list.
- [x] UI Ctrl+Click uses readiness:
  - `blocked`: show status and do not jump.
  - `partial/stale`: allow candidate only when confidence is exact.
  - `ready`: jump as usual.
- [x] Tests:
  - imported class jumps through stub dependency graph.
  - SDK API jumps through active SDK index.
  - stale index returns explainable non-jump state.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Ctrl\\+Click|definition"
```

Expected: definition behavior is query-facade-owned and explainable.

### Task 12: Completion Provider Uses Readiness and Stub Metadata

**Files:**
- Modify: `src/components/layout/completion-candidate-provider.ts`
- Modify: `src/components/layout/indexed-completion-model.ts`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/completion-candidate-provider.test.ts`
- Test: `tests/frontend/indexed-completion-model.test.ts`

- [x] Use readiness-envelope APIs when available.
- [x] Add completion detail from stub metadata:
  - method signature.
  - class container.
  - visibility.
  - source path and line.
- [x] Suppress stale workspace candidates when semantic completion is ready and exact.
- [x] Keep index-only fallback for language-service unavailable.
- [x] Tests:
  - stale indexed completion is hidden when semantic exact match exists.
  - current-file stub method includes signature.
  - SDK/API candidate includes declaration target.

Run:

```bash
pnpm exec vitest run tests/frontend/completion-candidate-provider.test.ts tests/frontend/indexed-completion-model.test.ts
pnpm build
```

Expected: completion uses richer stubs without regressing fallback behavior.

---

## Phase 6: UI and Operational Diagnostics

**Purpose:** Make the system maintainable in real projects by surfacing status, partial results, and repair actions.

### Task 13: Index Diagnostics Panel Data

**Files:**
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/workspace-api.test.ts`

- [x] Extend diagnostics with:
  - `stub_file_count`
  - `stub_declaration_count`
  - `dependency_edge_count`
  - `unresolved_import_count`
  - `parser_error_count`
  - `stale_generation_count`
  - `last_explain_status`
- [x] Tests verify counts after fixture workspace indexing.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_diagnostics_service_tests
pnpm exec vitest run tests/frontend/workspace-api.test.ts
```

Expected: diagnostics can prove whether stubs and dependency graph are populated.

### Task 14: User-Facing Explain Actions

**Files:**
- Create: `src/components/layout/IndexExplainPanel.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] Add compact explain panel opened from status/debug message.
- [x] Show facts as rows:
  - category
  - evidence
  - recommendation
- [x] Add actions:
  - `Rebuild Index`
  - `Open Settings`
  - `Retry Query`
- [x] Keep panel non-blocking; it must not replace Search Everywhere or completion.
- [x] Tests:
  - failed Ctrl+Click can open explain panel.
  - `Rebuild Index` calls existing rebuild command.
  - `Open Settings` opens settings modal.

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "explain|Rebuild Index|Open Settings"
pnpm build
```

Expected: missing-result diagnosis is visible and actionable.

---

## Execution Order

1. Phase 1: readiness models and envelope queries.
2. Phase 2: explain diagnostics service and command.
3. Phase 3: ArkTS stub parser and persistence.
4. Phase 4: dependency graph and invalidation.
5. Phase 5: definition/completion integration.
6. Phase 6: operational diagnostics UI.

Rationale:

- Readiness and explain diagnostics come first because they reduce ambiguity while implementing deeper parser/index changes.
- Stub index comes before dependency graph because dependency edges are extracted from parsed imports/exports.
- Definition/completion integration comes after stubs and dependency graph so UI features consume the stable facade rather than introducing another direct path.

## Verification Matrix

Run after every phase:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm exec vitest run tests/frontend/completion-candidate-provider.test.ts tests/frontend/indexed-completion-model.test.ts
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Search Everywhere|Ctrl\\+Click|completion|Ctrl\\+F7"
pnpm build
```

Run after dependency graph or search changes:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests workspace_index_worker_service_tests workspace_index_service_tests
```

Run before commit:

```bash
git status --short
wc -l src-tauri/src/services/workspace_arkts_stub_parser_service.rs src-tauri/src/services/workspace_stub_index_service.rs src-tauri/src/services/workspace_dependency_graph_service.rs src-tauri/src/services/workspace_index_readiness_service.rs src-tauri/src/services/workspace_index_explain_service.rs
```

Expected:

- All tests pass.
- New Rust service files stay under 500 lines.
- Existing compatibility commands still return old shapes until callers migrate to envelope APIs.

## Done Criteria

- Search Everywhere, global search, Ctrl+F7, completion, definition, and SDK/API lookup all use readiness-aware query paths.
- ArkTS project symbols come from persisted stubs, not only line-regex extraction.
- Changed file indexing expands through dependency graph when necessary.
- Missing lookup results can explain `excluded`, `notIndexed`, `stale`, `partial`, `sdkNotReady`, and `parserFailed`.
- Large project behavior is predictable: partial states are explicit, long work is backgrounded, and user-blocking queries do not silently scan everything.
