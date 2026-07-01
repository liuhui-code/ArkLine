# Index Core Goal Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue building ArkLine's index system into an IDE-grade durable knowledge layer for large-project search, navigation, usages, completion, SDK APIs, and health reporting.

**Architecture:** Keep SQLite as the durable fact store. Keep scheduler, worker, readiness, query facade, health, and semantic services separated into focused files. All user-facing IDE features must consume readiness-aware backend contracts instead of UI-only fallback chains.

**Tech Stack:** Rust/Tauri backend, SQLite, existing workspace index services, ArkTS/ETS/TS parser helpers, React/Vitest frontend API and UI tests, Cargo test suites.

---

## Active Goal

Current active goal:

> 制定并后续推进 ArkLine 对齐成熟 IDE 的索引系统长期演进目标与详细执行计划。

Product-level target:

- Double Shift can search `All`, files, classes, symbols, SDK APIs, and indexed text.
- Global content search is correct for normal text and transparent about fallback or partial readiness.
- Ctrl+Click and Find Usages share stable symbol/reference identity.
- Completion returns keywords, locals, members, imports, workspace symbols, SDK APIs, and snippets through one semantic path.
- Large projects index in bounded, interruptible work without blocking foreground navigation or completion.
- Health APIs explain missing, stale, partial, failed, blocked, and missing-SDK states.

## Current Baseline

Already implemented in the current branch:

- Shared lexical ranking for files, classes, symbols, and SDK APIs.
- Facade-backed Search Everywhere scopes including text candidates.
- Indexed global text search path with safe fallback rules.
- Semantic completion slices for keywords, locals, members, imports, workspace symbols, SDK APIs, snippets, and de-duplication.
- Scheduler priority classes, generation protection, cancellation tokens, bounded worker batches, queue pressure metrics, and state-machine labels.
- Full-refresh chunking primitives, continuation task planner, and manager requeue.
- Health service and frontend API contract.
- Large-project fixture and regression tests for search, definition, usages, completion, and refresh.

Known remaining gaps:

- Full-refresh continuation can be persisted, rehydrated on workspace open, and cleared after the final continuation chunk completes.
- Health has facts, but repair actions are not complete enough for user-driven rebuild and failure inspection.
- Symbol identity is still shallow for namespaces, broader project members, generics, async returns, and flow-sensitive narrowing.
- Completion lacks accept-history ranking, expected-type ranking, and explicit apply/import-edit flow.
- Search ranking lacks recency, opened-file, project-proximity, and text-candidate lexical parity.
- Query facade coverage still needs cleanup so all old commands are compatibility wrappers, not parallel behavior paths.

## Guardrails

- Keep new Rust service and test files under 500 lines.
- Use TDD for every behavior change: failing focused test first, then minimal implementation.
- SQLite stores durable facts; memory is only for queues, hot caches, active generations, cancellation tokens, and transient worker state.
- UI must not hide stale, partial, failed, missing, or blocked readiness.
- Prefer stable symbol ids over string matching whenever available.
- Do not commit or push unless explicitly requested.

## Execution Plan

### Stage 1: Wire Full-Refresh Continuation Requeue

**Goal:** A large full refresh should process one bounded chunk, then requeue remaining chunks without losing progress.

**Files:**

- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_index_continuation_task_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service_tests.rs`
- Modify: `docs/superpowers/plans/2026-07-01-ide-grade-index-roadmap.md`

- [x] Add a failing manager test proving a full refresh with remaining chunks schedules a follow-up `ChangedPaths` continuation task.
- [x] Add a failing worker/manager assertion proving the first chunk publishes partial progress instead of ready when chunks remain.
- [x] Wire `next_refresh_continuation_task` into the manager result handling path.
- [x] Preserve foreground priority by scheduling continuation as `FullRefresh`, behind foreground navigation/completion and visible-file work.
- [x] Preserve cancellation by ensuring continuation tasks use normal scheduler generations and stale-result protection.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_continuation_task_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_worker_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests
git diff --check
```

Expected result: full-refresh indexing yields across chunks and continues automatically without starving foreground IDE tasks.

### Stage 2: Persist Continuation And Resume State

**Goal:** Large refresh progress should survive worker ticks and eventually app restarts without redoing all work unnecessarily.

**Files:**

- Create: `src-tauri/src/services/workspace_index_resume_service.rs`
- Create: `src-tauri/src/services/workspace_index_resume_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add schema table for resumable index tasks: root path, task kind, generation, remaining paths, updated timestamp, and reason.
- [x] Add tests for saving, loading, replacing, and clearing resume records by root and task identity.
- [x] Save remaining continuation chunks before yielding from full refresh.
- [x] Clear resume records after final chunk reaches ready state.
- [x] On workspace open, enqueue resumable work after foreground open work but before background maintenance.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_resume_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_schema_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests
git diff --check
```

Expected result: large-project indexing can resume instead of restarting from zero after interruption.

### Stage 3: Complete Health Repair Actions

**Goal:** Health should not only explain problems; it should expose safe, explicit repair actions.

**Files:**

- Modify: `src-tauri/src/services/workspace_index_health_service.rs`
- Modify: `src-tauri/src/services/workspace_index_health_service_tests.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `tests/frontend/workspace-api.test.ts`

- [x] Add repair action ids: `rebuildProjectIndex`, `rebuildSdkIndex`, `inspectParserFailures`, `inspectUnresolvedImports`, and `resumeIndexing`.
- [ ] Add health tests for healthy, partial, stale, failed, missing SDK, queued, and resumable states.
- [ ] Add command/API wrappers that trigger rebuild or inspection through existing backend services.
  - [x] Add `resume_workspace_indexing` / `resumeWorkspaceIndexing` wrapper for persisted resume tasks.
  - [x] Add typed wrappers for SDK rebuild and parser/import inspection flows.
- [ ] Keep commands idempotent: repeated repair should enqueue or report existing work, not duplicate unbounded tasks.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests
pnpm exec vitest run tests/frontend/workspace-api.test.ts
git diff --check
```

Expected result: missing search/navigation/completion behavior has a clear explanation and a concrete repair path.

### Stage 4: Finish Unified Facade Adoption

**Goal:** Search, navigation, usages, completion, and text queries should flow through one readiness-aware backend contract.

**Files:**

- Modify: `src-tauri/src/services/workspace_index_facade_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_query_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/commands/workspace_definition.rs`
- Modify: `src/features/workspace/workspace-api.ts`

- [ ] Add facade tests for file symbols and global search readiness envelopes.
- [ ] Move file-symbol query path behind the facade.
- [ ] Move global text query path behind the facade compatibility wrapper.
- [ ] Keep old commands as thin wrappers until frontend call sites are fully migrated.
- [ ] Normalize readiness/explain fields across definition, usages, Search Everywhere, file symbols, completion, and text search.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests
pnpm exec vitest run tests/frontend/app-shell.test.tsx tests/frontend/workspace-text-search.test.ts
git diff --check
```

Expected result: feature behavior is easier to reason about because there is one query envelope and one readiness story.

### Stage 5: Strengthen Symbol Identity And References

**Goal:** Move from shallow string-based symbol matching toward IDE-grade identity for project and SDK symbols.

**Files:**

- Modify: `src-tauri/src/services/workspace_symbol_resolution_service.rs`
- Modify: `src-tauri/src/services/workspace_symbol_resolution_query_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_index_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_member_index_service.rs`
- Modify: `src-tauri/src/services/workspace_usage_query_service.rs`
- Modify: corresponding focused tests.

- [ ] Add namespace/member symbol ids for expressions like `Text().width` and project member chains.
- [ ] Resolve broader project class member access from imported receiver types.
- [ ] Resolve member access from generic and async return contexts where the parser can identify the declared return type.
- [x] Track local variable references separately from project symbol references.
- [x] Add confidence values: `exact`, `resolvedAlias`, `memberResolved`, `localScope`, and `unresolvedLikely`.
- [x] Group usages by file, kind, and confidence for the UI layer.
- [x] Resolve conservative `if/else` receiver-type joins without leaking single-branch assignments.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests
git diff --check
```

Expected result: Ctrl+Click and Find Usages become more reliable for real ArkTS project structure instead of simple same-file cases only.

### Stage 6: Improve Completion Ranking And Apply Metadata

**Goal:** Completion should feel closer to mature IDEs while staying deterministic and explainable.

**Files:**

- Modify: `src-tauri/src/services/workspace_completion_semantic_service.rs`
- Modify: `src-tauri/src/services/workspace_completion_item_service.rs`
- Modify: `src-tauri/src/services/workspace_completion_semantic_service_tests.rs`
- Modify: `src/components/layout/completion-candidate-provider.ts`
- Modify: `tests/frontend/completion-candidate-provider.test.ts`

- [ ] Add accept-history storage and ranking boost.
- [ ] Add expected-type boost when local parser context exposes assignment or parameter type.
- [ ] Add import-edit preview metadata for importable symbols.
- [ ] Keep actual import insertion behind an explicit apply path.
- [ ] Add tests for de-duplicating SDK/project symbols by stable identity.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_completion_semantic_service_tests
pnpm exec vitest run tests/frontend/completion-candidate-provider.test.ts
git diff --check
```

Expected result: completion quality improves without adding hidden edits or unstable UI-only ranking.

### Stage 7: Add Search Quality Signals

**Goal:** Search results should match mature IDE expectations for exact, prefix, camel-case, fuzzy, recency, and opened context.

**Files:**

- Modify: `src-tauri/src/services/workspace_search_ranking_service.rs`
- Modify: `src-tauri/src/services/workspace_search_ranking_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_text_candidate_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_service.rs`
- Modify: corresponding facade/query tests.

- [ ] Apply shared lexical ranking to text candidates.
- [ ] Add recency signal for recently opened and recently edited files.
- [ ] Add opened-file signal for currently visible editors.
- [ ] Add project-proximity signal so nearby files rank above distant matches when lexical score ties.
- [ ] Add large-result caps per scope with explicit truncation metadata.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_search_ranking_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests
pnpm exec vitest run tests/frontend/app-shell.test.tsx tests/frontend/workspace-text-search.test.ts
git diff --check
```

Expected result: Double Shift and global search return useful results first, with predictable caps and readiness.

## Recommended Next Step

Start with **Stage 3: Complete Health Repair Actions**.

Reason:

- Stage 1 and Stage 2 now cover chunk requeue, persistence, app-open rehydration, and cleanup.
- Health already reports index facts; repair actions are the next missing user-facing recovery layer.
- Repair actions will make missing search/navigation/completion states actionable instead of merely diagnostic.
- It can be implemented through backend contracts before any broad UI changes.

## Completion Criteria

This goal is complete when:

- Full refreshes chunk, yield, requeue, persist, resume, and finish without stale readiness.
- Health exposes repair actions and resumable state.
- All primary IDE queries go through readiness-aware facade contracts.
- Symbol/reference identity supports project members, SDK members, imports, local scopes, and confidence.
- Completion has semantic ranking, expected type/context signals, import metadata, and stable de-duplication.
- Search has mature lexical, recency, opened-context, project-proximity, and result-cap behavior.
- Large-project tests cover the core workflows and stay green.
