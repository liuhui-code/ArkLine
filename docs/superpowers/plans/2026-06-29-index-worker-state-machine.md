# Index Worker State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first maintainable background-indexing slice: richer task state, a worker execution boundary, and UI-consumable status updates.

**Architecture:** Keep the existing synchronous commands compatible while moving execution behind `WorkspaceIndexManagerRuntime`. The manager owns queue/status state; a worker runner drains tasks through one entry point; commands and future background threads submit work and observe status instead of directly composing index services.

**Tech Stack:** Rust/Tauri backend, SQLite-backed index services, React/Vitest frontend.

---

### Task 1: Complete Task Status Shape

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Test: `src-tauri/src/services/workspace_index_manager_service_tests.rs`

- [x] Add task status fields used by IDE-style progress reporting: `task_id`, `progress_current`, `progress_total`, `started_at`, `finished_at`, `error`.
- [x] Keep existing frontend fields backward compatible.
- [x] Verify queued and completed SDK tasks expose stable status.

### Task 2: Add Worker Execution Boundary

**Files:**
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Test: `src-tauri/src/services/workspace_index_manager_service_tests.rs`

- [x] Add a single worker-facing method that marks drained tasks `running`, executes them, then stores terminal status.
- [x] Keep `drain_index_task_results` as a compatibility wrapper.
- [x] Verify status order moves from `queued` to `ready`.

### Task 3: Add Tauri Status Event Surface

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] Emit or expose `workspace-index-task-updated` style status updates after worker execution.
- [x] Add frontend API type coverage for richer task status fields.
- [x] Verify Settings Apply updates the status bar from worker status.

### Task 4: Verification

**Commands:**
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "indexes SDK API symbols after applying SDK settings"`
- `pnpm build`

### Task 5: Background Submit Slice

**Files:**
- Modify: `src-tauri/src/services/workspace_index_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `src-tauri/src/services/workspace_index_manager_service_tests.rs`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] Make index runtimes cloneable shared state so commands can hand them to a background worker.
- [x] Add `start_background_worker` to drain queued tasks off the command path.
- [x] Add `submit_workspace_sdk_index` to return queued status immediately and emit worker status events.
- [x] Make Settings Apply prefer submit + wait-for-ready over synchronous SDK indexing.
- [x] Keep old synchronous SDK index command as fallback compatibility.

### Task 6: Worker Wake Loop

**Files:**
- Modify: `src-tauri/src/services/workspace_index_scheduler_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Test: `src-tauri/src/services/workspace_index_manager_service_tests.rs`

- [x] Add scheduler pending-task inspection.
- [x] Add worker wake signal to `WorkspaceIndexManagerRuntime`.
- [x] Keep the background worker alive briefly while idle.
- [x] Wake the worker when new tasks are scheduled.
- [x] Verify a worker started before a task is queued still processes the later task.

### Task 7: SDK Task Replacement

**Files:**
- Modify: `src-tauri/src/services/workspace_index_scheduler_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Test: `src-tauri/src/services/workspace_index_manager_service_tests.rs`

- [x] Replace queued SDK index tasks for the same workspace root.
- [x] Keep only the newest SDK task pending.
- [x] Return replaced tasks from the scheduler.
- [x] Store replaced SDK generations as `cancelled` statuses.
- [x] Verify status queries show the old generation as `cancelled` and the new generation as `queued`.

### Task 8: Manager File Split

**Files:**
- Create: `src-tauri/src/services/workspace_index_task_status_service.rs`
- Create: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Move task result/status construction into a dedicated task status service.
- [x] Move worker task execution into a dedicated worker service.
- [x] Keep `WorkspaceIndexManagerRuntime` focused on queue ownership, status storage, and worker wake control.
- [x] Keep all touched Rust files under 500 lines.

### Task 9: Task-Level Failure Terminal Status

**Files:**
- Modify: `src-tauri/src/services/workspace_index_task_status_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Create: `src-tauri/src/services/workspace_index_worker_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Convert per-task indexing errors into `failed` task results instead of aborting the whole worker batch.
- [x] Preserve callback/storage errors as worker-level failures.
- [x] Preserve `started_at`, `finished_at`, `generation`, and error message for failed task diagnostics.
- [x] Verify malformed SDK tasks expose a failed result with a stable error message.

### Task 10: Active SDK Index Metadata

**Files:**
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`

- [x] Add persistent active SDK metadata per workspace root.
- [x] Mark the active SDK path/version after successful SDK indexing.
- [x] Restrict SDK/API candidate queries to the active SDK metadata.
- [x] Expose active SDK path/version through index diagnostics.
- [x] Verify old SDK symbols no longer appear after switching to a newer SDK index.

### Task 11: Active SDK Diagnostics Count

**Files:**
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`

- [x] Align diagnostics `sdk_symbol_count` with the active SDK when metadata exists.
- [x] Keep legacy databases without active SDK metadata compatible by counting all SDK rows.
- [x] Verify switching SDKs reports only the active SDK symbol count.

### Task 12: Superseded SDK Symbol Pruning

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Remove superseded SDK symbol rows after a new SDK index succeeds.
- [x] Keep the active SDK metadata as the source of truth for query scope.
- [x] Verify switching SDKs leaves only the active SDK symbols in SQLite.

### Task 13: Atomic SDK Index Writes

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Wrap SDK symbol replacement, active metadata update, and superseded-row pruning in one SQLite transaction.
- [x] Preserve the previous active SDK index if a new SDK write fails partway through.
- [x] Verify injected insert failures do not leave partial SDK symbols behind.

### Task 14: SDK Member Modifier Parsing

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Parse SDK members after common TypeScript/ArkTS modifiers such as `public`, `private`, `protected`, `static`, `readonly`, and `abstract`.
- [x] Prevent modifiers from being indexed as member names.
- [x] Verify modified SDK declarations are queryable by their actual API names.

### Task 15: SDK Parser Service Split

**Files:**
- Create: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Move SDK source traversal and declaration/member parsing out of the SDK index storage service.
- [x] Keep `workspace_sdk_index_service` focused on persistence, active SDK metadata, query ranking, and transactions.
- [x] Keep both SDK parser and SDK index services under 500 lines before adding more parser coverage.

### Task 16: Generic and Optional SDK Member Classification

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Classify generic methods such as `getValue<T>()` as methods.
- [x] Classify optional methods such as `onReady?()` as methods.
- [x] Keep optional fields such as `optionalValue?: string` classified as properties.

### Task 17: SDK Namespace Containers

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Track `namespace` and `module` blocks as parser contexts.
- [x] Store namespace-qualified containers for functions, classes, and class members.
- [x] Verify queries such as `ArkUI animateTo` and `ArkUI Text width` resolve to indexed SDK API symbols.

### Task 18: SDK Type Alias Indexing

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Index `type` alias declarations as SDK API symbols.
- [x] Preserve namespace containers for type aliases.
- [x] Tighten declaration keyword matching so identifiers containing words like `type` are not misclassified.

### Task 19: SDK Test Split

**Files:**
- Create: `src-tauri/src/services/workspace_sdk_persistence_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Move active SDK metadata, superseded-row pruning, and atomic-write tests into a dedicated persistence test module.
- [x] Keep SDK parser/query tests focused on symbol extraction, ranking, and Search Everywhere inclusion.
- [x] Keep both SDK test files well below the 500-line maintenance limit.

### Task 20: Exported SDK Declaration Parsing

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Index exported declarations such as `export declare class`, `export interface`, `export function`, and `export type`.
- [x] Treat `export` as a member modifier so exported static members are indexed by their real names.
- [x] Verify exported declarations and members are queryable through the SDK index.

### Task 21: Inline SDK Type Members

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Parse members from single-line class/interface declarations.
- [x] Preserve the declaring type as the member container.
- [x] Verify inline properties and methods are queryable by qualified container terms.

### Task 22: SDK Enum Member Indexing

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] Treat enum declarations as member-owning SDK containers.
- [x] Parse multi-line enum members through the existing container context.
- [x] Parse single-line enum members by comma-separated body segments.
- [x] Verify qualified enum member queries such as `FontWeight Bold` and `InlineAlignment Center`.

### Task 23: Index Task Lifecycle Contract

**Files:**
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_index_task_status_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service_tests.rs`

- [x] Report unchanged watcher tasks as `skipped` with timing and generation metadata.
- [x] Keep skipped tasks visible through `get_index_task_statuses`.
- [x] Mark replaced pending refresh tasks as `superseded`.
- [x] Mark coalesced changed-path generations as `superseded`.
- [x] Mark running task results as `superseded` when a newer same-kind task is queued before completion.
- [x] Drop stale `refresh_result` payloads from superseded task results.
- [x] Report terminal queued-task replacements with completed progress and `finished_at`.
- [x] Let wider full-refresh/open tasks supersede narrower pending changed-path tasks.
- [x] Preserve priority ordering for independent roots after wider-task replacement.
- [x] Let newer wider pending tasks supersede narrower running task results.
- [x] Verify open-workspace supersedes pending and running refresh work.
- [x] Verify newer SDK tasks supersede stale running SDK results.
- [x] Split shared index test fixtures out of lifecycle tests to preserve the 500-line limit.
- [x] Split pending and running lifecycle integration tests into separate files.
- [x] Keep SDK task replacement status as `cancelled` for backward-compatible Settings Apply behavior.
- [x] Centralize task replacement and result-supersession rules in a lifecycle service.
- [x] Cover lifecycle replacement and supersession rules with explicit matrix tests.
- [x] Skip batch-local superseded narrow tasks before worker execution to avoid wasted indexing.
- [x] Skip stale SDK tasks superseded by newer SDK tasks in the same worker batch.
- [x] Preserve independent roots during worker batch-local supersession checks.
- [x] Verify batch-local superseded task results expose terminal metadata.
- [x] Reuse the lifecycle pending-replacement matrix for worker batch-local supersession.
- [x] Verify all Rust tests and frontend build after the lifecycle slice.

### Task 24: Persistent Index Task Journal

**Files:**
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Create: `src-tauri/src/services/workspace_index_task_journal_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/services/workspace_index_task_journal_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_manager_service_tests.rs`

- [x] Add a SQLite-backed `workspace_index_task_journal` table.
- [x] Persist task statuses keyed by root path and task id.
- [x] Load recent task statuses from the journal for a workspace.
- [x] Let manager store queued, running, cancelled, superseded, skipped, failed, and ready states.
- [x] Merge persisted statuses with in-memory pending tasks in `get_index_task_statuses`.
- [x] Keep all touched Rust files under 500 lines.
- [x] Verify all Rust tests and frontend build.

### Task 25: SQLite-First Unified Entity Query Facade

**Files:**
- Create: `src-tauri/src/services/workspace_index_entity_query_service.rs`
- Modify: `src-tauri/src/services/workspace_index_query_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/services/workspace_index_query_service_tests.rs`

- [x] Add a focused query facade that reads files and workspace symbols from SQLite structured tables.
- [x] Keep SDK/API candidates behind the same facade by delegating to the active SDK query.
- [x] Route `Files`, `Classes`, `Symbols`, `Apis`, and `All` scopes through the facade.
- [x] Preserve freshness metadata from the persisted workspace index status.
- [x] Verify restored SQLite indexes work without relying on in-memory runtime symbols.
- [x] Keep touched Rust files under 500 lines.
- [x] Verify all Rust tests and frontend build.

### Task 26: Persistent Symbol Entity Foundation

**Files:**
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Modify: `src-tauri/src/services/workspace_index_persistence_service.rs`
- Modify: `src-tauri/src/services/workspace_index_entity_query_service.rs`
- Test: `src-tauri/src/services/workspace_index_schema_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_query_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_service_tests.rs`

- [x] Add a `workspace_symbol_entities` table with stable `entity_id`, `qualified_name`, `source`, `kind`, `name`, `container`, `path`, `line`, `column`, `end_line`, `end_column`, `visibility`, `signature`, and `origin` columns.
- [x] Record a new `entity` schema domain version.
- [x] Persist entity rows alongside the legacy `workspace_symbols` table.
- [x] Let unified entity queries prefer `workspace_symbol_entities` and fall back to `workspace_symbols` for old caches.
- [x] Preserve existing Search Everywhere, Classes, Symbols, and freshness behavior.
- [x] Keep touched Rust files under 500 lines.
- [x] Verify all Rust tests and frontend build.

### Task 27: Incremental Symbol Entity Persistence

**Files:**
- Create: `src-tauri/src/services/workspace_index_entity_persistence_service.rs`
- Modify: `src-tauri/src/services/workspace_index_persistence_service.rs`
- Modify: `src-tauri/src/services/workspace_index_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/services/workspace_index_entity_persistence_service_tests.rs`

- [x] Move symbol entity row construction into a focused persistence helper service.
- [x] Add an incremental SQLite persistence path that updates metadata/catalog JSON, changed files, removed files, legacy symbols, and entity rows without deleting untouched entity rows.
- [x] Route changed-path refresh and explicit file updates through the incremental persistence path.
- [x] Verify unchanged file entity rows keep their SQLite rowid across a changed-path refresh.
- [x] Verify changed file entity rows replace stale symbols and write new entities.
- [x] Keep touched Rust files under 500 lines.
- [x] Verify all Rust tests and frontend build.

### Task 28: Atomic Incremental SQLite Persistence

**Files:**
- Modify: `src-tauri/src/services/workspace_index_persistence_service.rs`
- Modify: `src-tauri/src/services/workspace_index_entity_persistence_service.rs`
- Test: `src-tauri/src/services/workspace_index_entity_persistence_service_tests.rs`

- [x] Wrap full structured SQLite writes in one transaction.
- [x] Wrap incremental catalog, metadata, file, legacy symbol, and entity writes in one transaction.
- [x] Verify an injected incremental entity insert failure preserves the previous legacy symbol and entity rows.
- [x] Verify the persisted catalog JSON is not advanced when an incremental SQLite transaction rolls back.
- [x] Keep touched Rust files under 500 lines.
- [x] Verify all Rust tests and frontend build.

### Task 29: File-Scoped Entity Query API

**Files:**
- Modify: `src-tauri/src/services/workspace_index_entity_query_service.rs`
- Create: `src-tauri/src/services/workspace_index_entity_query_service_tests.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`

- [x] Add a backend query for symbols/entities in one file, backed by `workspace_symbol_entities`.
- [x] Support empty-query outline listing ordered by source location.
- [x] Support filtered file symbols without returning symbols from other files.
- [x] Expose the query through a Tauri command and TypeScript workspace API method.
- [x] Preserve fallback to legacy `workspace_symbols` for old caches without entity rows.
- [x] Keep touched Rust files under 500 lines.
- [x] Verify all Rust tests and frontend build.

### Task 30: Ctrl+F7 Uses Indexed File Symbols

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] Load indexed file symbols when opening the Ctrl+F7 current-class methods palette.
- [x] Prefer indexed method locations when available.
- [x] Preserve current-class scoping by intersecting indexed method names with the local current-class scan.
- [x] Fall back to the existing local scan when indexed file symbols are unavailable or empty.
- [x] Verify Ctrl+F7 still filters and jumps to methods.
- [x] Verify Ctrl+F7 calls `queryWorkspaceFileSymbols` and displays indexed method results.
- [x] Verify frontend build.

### Task 31: Indexed File Symbols Feed Completion

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] Convert indexed file symbol candidates into `LanguageCompletionItem` values.
- [x] Merge indexed completion candidates after language-service candidates, preserving language-service priority.
- [x] De-duplicate merged completion items by label and kind.
- [x] Keep indexed completion lookup as a fallback layer that cannot fail the main completion request.
- [x] Verify completion still opens and can show indexed symbols when the language service returns no candidates.

### Task 32: Project-Scoped Indexed Completion Baseline

**Files:**
- Create: `src/components/layout/indexed-completion-model.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] Extract indexed completion conversion and merge logic out of `AppShell`.
- [x] Add project-scoped indexed symbol/class/API candidates to completion when a prefix is available.
- [x] Add ArkTS keyword completions for common syntax and visibility modifiers.
- [x] Preserve language-service priority over indexed and keyword candidates.
- [x] Verify workspace indexed symbols and `private` keyword appear in completion.

### Task 33: Indexed Completion Model Regression Tests

**Files:**
- Create: `tests/frontend/indexed-completion-model.test.ts`

- [x] Verify indexed methods become callable completion items with definition targets.
- [x] Verify current-file candidates retain current-file detail for ranking.
- [x] Verify SDK API candidates map to SDK completion source.
- [x] Verify ArkTS keyword completions require a meaningful prefix.
- [x] Verify semantic completion groups remain authoritative during de-duplication.
- [x] Verify indexed symbol candidates still feed Ctrl+F7 current-class method entries.

### Task 34: Completion Candidate Provider Boundary

**Files:**
- Create: `src/components/layout/completion-candidate-provider.ts`
- Create: `tests/frontend/completion-candidate-provider.test.ts`
- Modify: `src/components/layout/AppShell.tsx`

- [x] Move semantic, current-file index, workspace index, and keyword completion collection out of `AppShell`.
- [x] Keep language-service failures visible while treating indexed lookup failures as non-fatal.
- [x] Avoid workspace-wide indexed completion queries when there is no prefix.
- [x] Verify provider combines semantic, file-index, workspace-index, and keyword completions.
- [x] Verify provider preserves semantic completions when indexed queries fail.

### Task 35: Parallel Completion Candidate Collection

**Files:**
- Modify: `src/components/layout/completion-candidate-provider.ts`
- Modify: `tests/frontend/completion-candidate-provider.test.ts`

- [x] Start semantic, file-index, and workspace-index completion requests in the same turn.
- [x] Preserve semantic completion as the authoritative failure surface.
- [x] Use settled indexed requests so file/workspace index failures still degrade silently.
- [x] Preserve merge ordering: semantic, current-file index, workspace index, keywords.
- [x] Verify indexed lookups start before semantic completion resolves.

### Task 36: Index-Only Completion Fallback

**Files:**
- Modify: `src/components/layout/completion-candidate-provider.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/completion-candidate-provider.test.ts`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] Allow completion collection when `completeSymbol` is unavailable.
- [x] Let indexed file, workspace, and keyword candidates provide fallback completions.
- [x] Remove the UI-level early return that blocked completion without language-service support.
- [x] Verify provider returns indexed and keyword candidates without semantic completion.
- [x] Verify Ctrl+Space can open indexed completions when language-service completion is unavailable.
