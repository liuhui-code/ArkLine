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
- Four-layer index readiness and dual-channel project/SDK parsing strategy.
- SDK API-only scan plan with chunked progress and foreground-safe scheduling.
- Health service and frontend API contract.
- Large-project fixture and regression tests for search, definition, usages, completion, and refresh.
- Real-project interaction smoothness gate for open-path indexing, Double Shift, Ctrl+Shift+F,
  current-file readiness, and foreground single-file indexing.
- Search interaction responsiveness gate for rapid input/delete, close, jump, and UI latency evidence.

Known remaining gaps:

- Open lightweight indexing still exceeds the initial 800ms target on the ArkLine baseline:
  20,000 files measured 1123ms on 2026-07-07.
- Full-refresh continuation can be persisted, rehydrated on workspace open, and cleared after the final continuation chunk completes.
- Health exposes core repair actions; remaining work is to keep query recommendations, health repair evidence, and future actions on one typed action model.
- Symbol identity is still shallow for namespaces, broader project members, generics, async returns, and flow-sensitive narrowing.
- Completion lacks accept-history ranking, expected-type ranking, and explicit apply/import-edit flow.
- Search ranking now has text lexical parity, recency/opened-file context, and project-proximity; remaining search work is mainly broader usage validation and future ranking telemetry.
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
- [x] Run:

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
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `tests/frontend/workspace-api.test.ts`

- [x] Add repair action ids: `rebuildProjectIndex`, `rebuildSdkIndex`, `inspectParserFailures`, `inspectUnresolvedImports`, and `resumeIndexing`.
- [x] Add health tests for healthy, partial, stale, failed, missing SDK, queued, and resumable states.
- [x] Add command/API wrappers that trigger rebuild or inspection through existing backend services.
  - [x] Add `resume_workspace_indexing` / `resumeWorkspaceIndexing` wrapper for persisted resume tasks.
  - [x] Add typed wrappers for SDK rebuild and parser/import inspection flows.
- [x] Project and SDK queued work project diagnostics as `queued`, without suggesting duplicate rebuild/configure actions.
- [x] Keep commands idempotent: repeated repair should enqueue or report existing work, not duplicate unbounded tasks.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_diagnostics_service_tests
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

- [x] Add facade tests for file symbols and global search readiness envelopes.
- [x] Move file-symbol query path behind the facade.
- [x] Move global text query path behind the facade compatibility wrapper.
- [x] Move completion query path behind the facade compatibility wrapper.
- [x] Keep old commands as thin wrappers until frontend call sites are fully migrated.
- [x] Normalize readiness/explain fields across definition, usages, Search Everywhere, file symbols, completion, and text search.
- [x] Record facade query explain/readiness events into the unified index event log for diagnostics.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_completion_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests
pnpm exec vitest run tests/frontend/workspace-api.test.ts tests/frontend/workspace-text-search.test.ts tests/frontend/completion-candidate-provider.test.ts tests/frontend/indexed-completion-model.test.ts
git diff --check
```

Expected result: feature behavior is easier to reason about because there is one query envelope and one readiness story.

### Stage 4.5: Real-Project Interaction Smoothness Gate

**Goal:** Keep large-project responsiveness measurable with a repeatable local profile before
changing scheduler, scanner, or query code.

**Files:**

- Create: `src-tauri/src/services/workspace_interaction_perf_fixture_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`

- [x] Add an ignored test that reads `ARKLINE_PROFILE_ROOT` and profiles:
  open lightweight indexing, current-file readiness, Double Shift first result,
  Ctrl+Shift+F first batch, and foreground single-file readiness.
- [x] Keep thresholds report-first by default and fail only when
  `ARKLINE_STRICT_PERF=1`.
- [x] Record the ArkLine baseline:
  `files=20000`, `open_lightweight=1123ms`, `first_file_readiness=3ms`,
  `double_shift_first_result=306ms`, `ctrl_shift_f_first_batch=25ms`,
  `foreground_readiness=142ms`.
- [x] Identify the slowest current stage: open lightweight indexing.

Run:

```bash
cd src-tauri
ARKLINE_PROFILE_ROOT=/Users/liuhui/Documents/code/ArkLine cargo test verifies_real_project_interaction_smoothness -- --ignored --nocapture
```

Expected result: local profiling produces a readable report, and strict mode can be used as a
future regression gate once the open-path target is realistic.

### Stage 5: Strengthen Symbol Identity And References

**Goal:** Move from shallow string-based symbol matching toward IDE-grade identity for project and SDK symbols.

**Files:**

- Modify: `src-tauri/src/services/workspace_symbol_resolution_service.rs`
- Modify: `src-tauri/src/services/workspace_symbol_resolution_query_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_index_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_member_index_service.rs`
- Modify: `src-tauri/src/services/workspace_usage_query_service.rs`
- Modify: corresponding focused tests.

- [x] Add namespace/member symbol ids for expressions like `Text().width` and project member chains.
- [x] Resolve broader project class member access from imported receiver types.
- [x] Resolve member access from generic and async return contexts where the parser can identify the declared return type.
- [x] Preserve concrete generic receiver bindings across chained member access, for example `Box<Response<UserService>> -> box.value.data.load`.
- [x] Track local variable references separately from project symbol references.
- [x] Add confidence values: `exact`, `resolvedAlias`, `memberResolved`, `localScope`, and `unresolvedLikely`.
- [x] Group usages by file, kind, and confidence for the UI layer.
- [x] Resolve conservative `if/else` receiver-type joins without leaking single-branch assignments.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_receiver_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_member_query_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_chain_receiver_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_deep_generic_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_branch_flow_tests
git diff --check
```

Expected result: Ctrl+Click and Find Usages become more reliable for real ArkTS project structure instead of simple same-file cases only.

### Stage 6: Improve Completion Ranking And Apply Metadata

**Goal:** Completion should feel closer to mature IDEs while staying deterministic and explainable.

**Files:**

- Modify: `src-tauri/src/services/workspace_completion_semantic_service.rs`
- Create: `src-tauri/src/services/workspace_completion_expected_type_service.rs`
- Modify: `src-tauri/src/services/workspace_completion_item_service.rs`
- Modify: `src-tauri/src/services/workspace_completion_semantic_service_tests.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Create: `src/components/layout/completion-history-store.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/completion-model.ts`
- Modify: `src/components/layout/completion-candidate-provider.ts`
- Create: `tests/frontend/completion-history-store.test.ts`
- Modify: `tests/frontend/completion-model.test.ts`
- Modify: `tests/frontend/completion-candidate-provider.test.ts`

- [x] Add accept-history storage and ranking boost.
- [x] Add expected-type boost when local parser context exposes assignment type.
- [x] Add expected-type boost when local parser context exposes parameter type.
- [x] Add import-edit preview metadata for importable project symbols.
- [x] Keep actual import insertion behind an explicit apply path.
- [x] Add tests for de-duplicating SDK/project symbols by stable identity.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_completion_semantic_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_completion_tests
pnpm exec vitest run tests/frontend/completion-history-store.test.ts tests/frontend/completion-model.test.ts tests/frontend/completion-candidate-provider.test.ts tests/frontend/indexed-completion-model.test.ts tests/frontend/workspace-api.test.ts
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t "prioritizes the most recently accepted completion item"
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t "keeps the closer prefix match ahead"
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
- Modify: `src/components/layout/search-overlay-model.ts`
- Create: `tests/frontend/search-overlay-model.test.ts`
- Modify: corresponding facade/query tests.

- [x] Apply shared lexical ranking to text candidates.
- [x] Add recency signal for recently opened and recently edited files.
- [x] Add opened-file signal for currently visible editors.
- [x] Add project-proximity signal so nearby files rank above distant matches when lexical score ties.
- [x] Add large-result caps per scope with explicit truncation metadata.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_search_ranking_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests
pnpm exec vitest run tests/frontend/search-overlay-model.test.ts
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t "Search Everywhere"
pnpm exec vitest run tests/frontend/workspace-text-search.test.ts tests/frontend/workspace-api.test.ts tests/frontend/workspace-index-store.test.ts
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

## Large-Project Performance Audit

- [x] `cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests`
  verifies search, definition, usages, completion, and refresh on the large fixture.
- [x] `ARKLINE_LARGE_FIXTURE_FILES=1000 cargo test --manifest-path src-tauri/Cargo.toml verifies_generated_large_workspace_fixture_pipeline -- --ignored --nocapture`
  originally completed with 1,000 files, 1,000 indexed files, 20 quick-open hits, and about 26.4s index time.
- [x] Content indexing and fingerprint writes now run in SQLite transactions; the 1,000-file full deep index improved to about 12.4s.
- [x] Stage profiling showed the remaining 1,000-file deep-index bottleneck is `catalog_stub_reference` at about 13.2s; schema, symbols, content, and fingerprints are all sub-second.
- [x] Workspace open now has a lightweight foreground path that persists file catalog rows without blocking on project-wide symbol, stub, reference, or dependency rows.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml verifies_generated_large_workspace_open_pipeline -- --ignored --nocapture`
  completed with 10,000 files, 10,000 indexed files, about 296ms open-index time, and about 154ms quick-open query time after removing project-wide symbol extraction from the foreground open path.
- [x] Full-refresh continuation now carries all remaining paths instead of only the next chunk, and partial task statuses report real chunk progress through `progressCurrent/progressTotal`.
- [x] Full-refresh continuation work now requeues across chunks, skips repeated full-workspace scan and stale fingerprint pre-scan for continuation tasks, and avoids per-chunk legacy JSON writes.
- [x] Incremental content indexing now skips expensive FTS deletes for paths that are not already indexed, preserving modified-file replacement behavior while making full-refresh continuation append mostly linear.
- [x] Incremental SQLite restore now prefers structured rows over legacy `workspace_catalog.state_json`, and incremental persistence no longer rewrites the full JSON catalog on every chunk.
- [x] `workspace_resolved_symbols` now has a `(root_path, path)` lookup index, reducing second-chunk symbol-resolution time in the 2,000-file fixture from about 4.51s to about 226ms.
- [x] The earlier 10,000-file open-plus-background profile was invalid because continuation dropped later chunks; after fixing correctness, the complete 10,000-file profile exposed a path-delete index gap in `workspace_symbols`, with continuation ticks climbing from about 1.6s to about 12s.
- [x] `workspace_symbols` now has a `(root_path, path)` lookup index, reducing continuous 10,000-file update chunks from about 70s total to about 20s total and reducing the end-to-end open-plus-background profile to about 18.66s.
- [x] Incremental reference indexing now loads declaration and alias rows only for affected paths and skips global member-reference context when the current chunk has no member access, reducing the 10,000-file end-to-end open-plus-background profile further to about 16.47s with stable 1.5-1.7s continuation ticks.
- [x] Incremental symbol/entity persistence now reuses prepared statements for changed-symbol inserts, reducing per-chunk symbol persistence from roughly 230-255ms to roughly 130-160ms and lowering the 10,000-file open-plus-background profile to about 15.5s.
- [x] Incremental stub persistence now reuses prepared statements for stub file/declaration/import/export/error inserts, reducing per-chunk stub insertion from roughly 230-240ms to roughly 160-170ms and lowering the 10,000-file open-plus-background profile to about 14.81s.
- [x] File fingerprint classification/update/remove now reuse prepared SQLite statements; the 10,000-file update stage profile shows fingerprint persistence at about 60-74ms per 1,024-file chunk, so remaining continuation latency is now dominated by structured persistence, symbol resolution, and reference refresh rather than fingerprint storage.
- [x] Foreground navigation/completion priority tasks now run as exclusive bounded worker batches, so `OpenWorkspace` can publish before the lower-priority `RefreshWorkspace` tail starts.
- [x] Incremental stub refresh now updates `workspace_symbol_references` only for changed/removed paths, preserving unchanged file references and avoiding a full-project reference rewrite for every continuation chunk.
- [x] Incremental symbol resolution now deletes and rebuilds resolved/unresolved rows only for changed/removed paths while keeping unchanged resolved symbols intact.
- [x] Incremental dependency graph updates now preserve unaffected edges and rebuild only changed/removed path edges, keeping reverse dependency expansion stable without clearing the full graph per chunk.
- [x] Reference indexing now reuses batch-loaded SDK/project member targets and skips identifier/member scans when there is no possible output; the 1,000-file stage profile improved `catalog_stub_reference` from about 12.16s to about 896ms and `references` from about 12.25s to about 239ms.
- [x] `ARKLINE_LARGE_FIXTURE_FILES=10000 cargo test --manifest-path src-tauri/Cargo.toml verifies_generated_large_workspace_fixture_pipeline -- --ignored --nocapture`
  now completes the default 10,000-file full deep-index fixture with about 11.94s index time and 20 quick-open hits.
- [x] Full-refresh continuation now has explicit `full-refresh-files` and `full-refresh-deep` phases. File/symbol-layer continuation ticks run first and measured about 0.53-0.72s per 1,024-file chunk on the 10,000-file open-plus-background profile; deep persistence follows as background work at about 1.4-1.9s per chunk.
- [x] Scheduler, resume, and result-supersession rules now keep file-layer and deep-layer changed-path tasks separate by reason, so background deep work cannot merge with or supersede foreground file readiness.
- [x] Deep-layer continuation now skips duplicate file/symbol/fingerprint persistence and runs only content plus stub/resolution/reference/dependency persistence. The 10,000-file open-plus-background profile improved from about 24.1s to about 16.74s total, with deep ticks reduced to about 0.96-1.04s.
- [x] Changed stub-row deletion now reuses prepared statements per table, reducing per-chunk stub delete time from roughly 40ms to about 5-8ms and improving the 10,000-file open-plus-background profile to about 16.32s total.
- [x] Reference refresh now reuses path-delete statements and a declaration-reference insert statement across each chunk. Reference duration improved from roughly 180-260ms to about 126-195ms per chunk, and the 10,000-file open-plus-background profile improved to about 15.53s total with deep ticks around 0.84-0.88s.
- [x] Symbol resolution now reuses path-delete statements and a resolved-symbol insert statement across each chunk. Resolution duration improved from roughly 170-195ms to about 109-143ms per chunk, and the 10,000-file open-plus-background profile improved to about 14.98s total with deep ticks around 0.78-0.83s.
- [x] Import/export alias resolution now uses the same reusable resolved-symbol insert statement as project declarations. Resolution duration measured about 70-117ms per 1,024-file chunk, and the 10,000-file open-plus-background profile measured about 14.89s total with first editor readiness around 482ms.
- [x] Member-reference indexing now reuses one prepared insert statement per indexed file instead of preparing through `connection.execute` for every member access. The generated 10,000-file fixture is not member-write heavy, so reference duration stayed roughly flat at about 126-196ms per 1,024-file chunk; the change mainly protects real ArkTS projects with dense member chains.
- [x] Stub insert profiling now reports parse and write time separately. The parser was also fixed to avoid treating call expressions inside member bodies, such as `Text("hello")`, as struct/class member declarations. On the 10,000-file profile this reduced stub insert from roughly 160-190ms to about 133-150ms per 1,024-file chunk, reduced downstream resolve/reference work, and lowered the open-plus-background profile to about 13.90s total.
- [x] Reference refresh now reuses source file content between member-access detection and reference indexing, and member-access detection uses a zero-allocation boolean scan. The generated 10,000-file fixture still measured roughly 106-109ms reference refresh after warmup, so this is mainly a structural cleanup that avoids duplicate reads/context loading rather than a major generated-fixture win.
- [x] Symbol resolution now uses conditional `(path, name)` lookup maps for import/re-export binding resolution, avoiding repeated declaration scans in import-heavy projects while skipping the map build for pure declaration chunks. The generated 10,000-file page fixture has no import-heavy chunks, so resolve time stayed roughly flat at about 73-86ms after warmup.
- [x] Pure declaration changed-path chunks now skip import/re-export/unresolved-import resolution entirely after project declaration rows are written. This reduced generated 10,000-file resolve time to about 67-75ms per 1,024-file chunk after warmup, and the open-plus-background profile measured about 13.80s total.

## Query Observability Audit

- [x] Facade query explanations now report query kind, used index layers, result count, readiness state, confidence, skipped commit stage, and readiness reason for blocked/stale/partial queries. This moves definition, usages, Search Everywhere, file symbols, completion, and text search closer to IDEA-style explainability instead of opaque query misses.
- [x] Facade typed-query envelope projection now lives in a separate service, keeping the facade focused on query routing and preserving room under the 500-line service limit for future diagnostics and readiness behavior.
- [x] Search Everywhere, file-symbol, and text-search facade query construction now lives in a focused search facade service, reducing the main facade to a thinner routing layer while preserving query explain/readiness behavior.
- [x] Definition/usages and completion facade query construction now live in focused navigation and completion services. The main facade is now a thin routing and event-recording layer, leaving future work to extend diagnostics without crowding query implementation details.
- [x] Frontend workspace index API types now live in a focused `workspace-index-api-types` module and are re-exported from the legacy workspace API entry point. This starts reducing the oversized API file before wiring query-envelope explain data into UI diagnostics.
- [x] Frontend workspace index query command wrappers now live in a focused `workspace-index-query-api` factory and are composed into the legacy `defaultWorkspaceApi`. This keeps existing callers stable while moving Search Everywhere, file-symbol, definition, usages, completion, and explain calls toward a maintainable index API boundary.
- [x] Frontend workspace index management wrappers now live in a focused `workspace-index-management-api` factory. Diagnostics, health, file readiness, task status watching, SDK indexing, refresh, and workspace index watching are composed into the legacy API without changing callers.
- [x] Search Everywhere now preserves query-envelope readiness and explain data. Empty result states prefer backend facade explain reasons before issuing a separate explain query, so partial/stale indexed queries can report the real reason directly in the UI status path.
- [x] Search Everywhere entity query execution no longer falls back to legacy non-envelope backend APIs. It uses readiness envelopes when available and local in-memory fallback otherwise, keeping indexed query behavior observable.
- [x] The legacy Tauri `query_workspace_search_everywhere` command now delegates to the readiness-aware facade and returns only `items` for compatibility, eliminating another parallel backend search behavior path.
- [x] Go to Definition and Ctrl+Click miss states now prefer query-envelope explain data from the definition facade before issuing a separate explain query. This keeps foreground navigation diagnostics on the same observable query path as Search Everywhere and avoids losing the real partial/stale index reason.
- [x] Find Usages empty states now surface query-envelope explain reasons in the usages panel. `Ctrl+F7` can now tell the user when usage references are still partial/stale instead of collapsing every zero-result indexed query into a generic "No usages found" message.
- [x] Query-envelope explain formatting now lives in a focused frontend model with unit coverage. Search Everywhere, Definition, and Find Usages share the same reason/readiness/result-count interpretation instead of duplicating diagnostic parsing inside `AppShell`.
- [x] Completion candidate collection now has a result API that preserves semantic, file-symbol, and workspace query-envelope explain evidence while keeping the legacy item-array API compatible. Manual empty completion now shows the real index reason in the completion popup instead of only "No completions".
- [x] Completion indexed candidate collection no longer falls back to legacy non-envelope file-symbol or workspace candidate APIs. Indexed completion data now comes from readiness envelopes or stays empty, preserving explain/readiness consistency.
- [x] Frontend file-symbol callers no longer expose or consume the legacy non-envelope `queryWorkspaceFileSymbols` API. Ctrl+F12 and indexed file-symbol completion now use readiness envelopes only.
- [x] Frontend Search Everywhere and workspace-candidate callers no longer expose or consume the legacy non-envelope `queryWorkspaceSearchEverywhere` / `queryWorkspaceCandidates` API fields. Entity search and indexed completion now use readiness envelopes only, while backend legacy commands remain compatibility wrappers.
- [x] Backend legacy Search Everywhere, workspace-candidate, and file-symbol command wrappers now have regression coverage proving they return facade items/envelopes instead of owning parallel query behavior. Ordinary Search Everywhere and SDK search regression tests now use facade readiness wrappers; the remaining direct search helper is explicitly named `query_workspace_search_everywhere_raw_baseline` and limited to the interaction performance fixture.
- [x] Backend command-service helper names now distinguish `compat` item-array Search Everywhere support from `facade` envelope candidate/file-symbol support while keeping public Tauri command names stable.
- [x] Workspace query Tauri commands now live in a focused `commands/workspace_query.rs` module, reducing `commands/workspace.rs` from 497 lines to a maintainable size before the next index-command phase.
- [x] SDK Search Everywhere facade regression coverage now lives in a focused `workspace_sdk_search_facade_tests` module, keeping SDK index tests below the 500-line ceiling.
- [x] The Index Diagnostics Center now includes recent frontend query explain evidence. Search, Definition, Find Usages, and Completion misses recorded from the UI can be inspected from the status bar diagnostics entry even before the backend event log refresh catches up.
- [x] Recent query explain retention now lives in a focused workspace store with unit coverage. `AppShell` only records query evidence and renders a snapshot, keeping retention limits and empty-evidence filtering out of the UI shell.
- [x] Recent query explain React wiring now lives in `useWorkspaceQueryExplains`. `AppShell` no longer owns the store ref or snapshot synchronization details, reducing shell coupling before larger query-controller extraction.
- [x] Definition miss message construction and envelope-explain formatting now live in a focused definition query model with unit coverage. `AppShell` still orchestrates navigation, but no longer owns the duplicated Ctrl+Click / Go to Definition miss wording rules.
- [x] Definition candidate projection into the shared editor query panel now lives in the definition query model. Indexed, semantic, and fallback multi-target definition paths use the same candidate-to-panel item mapping instead of duplicating `kind/confidence` construction in `AppShell`.
- [x] Definition candidate status, panel, debug, and refresh-wait wording now live in the definition query model. `AppShell` no longer owns the repeated "Definition candidates", Ctrl+Click multi-target, or partial/stale wait message construction.
- [x] Definition query entry, blocked, and resolved-state wording now live in the definition query model. `AppShell` still performs the side effects, but no longer owns the repeated SDK-applying, unavailable, query-started, blocked, resolved, or fallback status/debug messages.
- [x] Definition readiness-envelope branching now has a pure frontend decision function with unit coverage. `AppShell` consumes `blocked`, `candidates`, `resolved`, `waitForRefresh`, and `defer` outcomes instead of open-coding readiness and candidate-count rules. Indexed, semantic, and fallback multi-candidate results now share one editor-query-panel path.
- [x] Definition resolved-target and miss side effects now use shared local helpers inside `AppShell`. Indexed, semantic, and fallback jump targets share one navigation/focus/status path, while indexed-only and language/fallback miss paths share one explain/diagnostic recording path.
- [x] Query-envelope explain data now has a frontend summary model for action, used layers, skipped layers, readiness, result count, generation gap, and retryability. The Index Diagnostics Center renders that evidence as readable fields while preserving raw explain text for developer investigation.
- [x] Backend facade query events now reuse the same explain summary model by parsing `payloadJson.explain`. Diagnostics Center backend events no longer require reading raw JSON to understand action, used/skipped index layers, readiness, retryability, or generation gaps.
- [x] Frontend query explains and backend facade query events now render through one newest-first Query Explain timeline. Each event keeps a `frontend` or `backend` source label, so diagnostics can correlate UI-observed misses with backend-recorded query events without jumping between separate lists.
- [x] Query Explain timeline items now include severity, compact display time, and deterministic tie-breaking. Backend events sort ahead of frontend observations when timestamps tie, preserving a stable audit trail for rapid miss/blocked diagnosis.
- [x] Query Explain action handling now routes more backend recommendations through concrete repair UI: rebuild SDK index, index current file, inspect parser failures, and inspect unresolved imports.
- [x] Discovery state now appears in diagnostics and health contracts, including discovery status, discovered file count, excluded count, and cursor-more state, so large-project indexing can explain file enumeration separately from deeper index work.
- [x] Current-file readiness now has a large-project foreground-navigation regression gate. The test protects the contract that an active file can become navigation-ready before full background refresh completes.

Next performance priority: reduce the remaining deep-layer cost inside stub insert, symbol resolution, reference refresh, and dependency graph updates without regressing the foreground file/symbol readiness ticks.

Deep-layer performance v2 progress:

- [x] Deep-layer performance v3 now has a structured gate boundary. Future
  optimization must start from `WorkspaceIndexPerfGateReport.slowest_stage`
  and threshold violations, then prove the foreground current-file readiness
  gate still passes before changing indexing internals.
- [x] Deep-layer performance reports now flow into unified diagnostics as
  `performance/deep-layer` events, and an explicit `ARKLINE_PROFILE_ROOT`
  ignored hook can profile real projects with `source=project` evidence.
- [x] Identifier reference refresh now has a tested per-file alias prefilter. Incremental reference indexing skips full token scanning for source files whose content does not contain any resolved alias name for that same path, while preserving local-scope deep indexing and member-reference indexing paths.
- [x] Dependency graph incremental refresh now has a tested path-level planner. Changed files with no new import/export rows, no existing dependency facts, and no removed-path status skip dependency edge cleanup/rebuild, while files with old edges, unresolved imports, new imports/re-exports, or removals still refresh safely.
- [x] Symbol resolution incremental refresh now has a tested planner boundary. Pure declaration path chunks resolve only affected declarations, while chunks with import/re-export bindings still route through full binding resolution; this keeps the main symbol resolution service small enough for future branch-specific optimizations.
- [x] Stub refresh incremental work now has a tested path planner. Changed and removed paths are normalized/deduped once, then reused across stub row cleanup, stub parse/write, dependency graph refresh, symbol resolution, and reference refresh so future batching can optimize one stable boundary instead of five call sites.
- [x] Incremental SQLite persistence now has a shared changed/removed/affected path plan. File rows, symbol rows, and deep stub refresh consume one normalized path contract, reducing duplicate path-union work and protecting future direct persistence callers from mixed separator or duplicate path input.
- [x] Empty incremental SQLite persistence now short-circuits before opening or creating the store. No-op file/symbol/deep refresh calls no longer create `.arkline/index` or enter schema/transaction work, reducing useless IO during rapid editor and query churn.
- [x] Empty changed-path worker tasks now short-circuit before fingerprint/readiness checks and return a skipped result without creating an index store. This keeps watcher/editor no-op churn out of the backend indexing pipeline.
- [x] The scheduler now drops non-discovery empty changed-path tasks before they enter the queue while preserving empty workspace-discovery tasks that start root enumeration. This prevents no-op watcher/editor churn from inflating queue pressure or task status noise.
- [x] Manager task-status persistence and superseded-result marking now live in `workspace_index_manager_status_service`, reducing `workspace_index_manager_service` from the 497-line danger zone and keeping future scheduler/worker changes away from journal bookkeeping.
- [x] Manager background-worker tests now live in `workspace_index_manager_worker_tests`, reducing `workspace_index_manager_service_tests` from the 488-line danger zone and leaving space for future high-frequency scheduling regressions.
- [x] Frontend foreground completion/navigation indexing now has a short-window schedule gate per root/path/kind. Rapid typing or repeated Ctrl+Click on the same file no longer sends duplicate foreground index schedule commands while semantic completion and definition queries still run normally.
- [x] Visible-file indexing now uses the same short-window schedule gate per root/path. Project open and file visibility updates still schedule newly visible files, but rapid duplicate visibility events no longer enqueue redundant backend work.
- [x] The scheduler now treats duplicate changed-path subsets with no priority increase as no-op work. Manager watcher scheduling skips cancellation, status journaling, pending-status writes, and worker wakeups for those duplicate events, reducing file-watcher churn under rapid saves.
- [x] Follow-up, continuation, and resume task scheduling now consume the scheduler's `scheduled` result. Duplicate no-op internal tasks no longer report pending roots, save redundant resume records, or trigger downstream pending-status writes.
- [x] Changed-path worker filtering and chunk refresh helpers now live in `workspace_index_changed_path_worker_service`, reducing `workspace_index_worker_service` from the 478-line danger zone while preserving foreground-readiness, fingerprint, config-change, and chunk-combine behavior.
- [x] Worker batch/supersede/cancellation coverage now lives in `workspace_index_worker_batch_tests`, reducing `workspace_index_worker_service_tests` from the 485-line danger zone and leaving room for future changed-path and budget regressions.
- [x] Workspace index restore/cache coverage now lives in `workspace_index_restore_tests`, reducing `workspace_index_service_tests` from the 495-line danger zone while preserving JSON cache, SQLite cache, structured-symbol restore, and metadata restore coverage.
- [x] Index diagnostics coverage is now split by responsibility: core storage/discovery/repair tests stay in `workspace_index_diagnostics_service_tests`, event/timeline tests live in `workspace_index_diagnostics_event_tests`, and SDK/queue projection tests live in `workspace_index_diagnostics_sdk_tests`. This reduces the diagnostics test file from the 483-line danger zone to 206 lines.
- [x] Definition candidate index resolution now lives in `workspace_definition_candidate_query_service`. `workspace_index_query_service` is reduced from 425 lines to 165 lines and now focuses on query routing, readiness envelopes, and text-search routing while import/default-export/SDK/same-file definition lookup has a dedicated resolver boundary.
- [x] Frontend Index Diagnostics Center query-evidence coverage now lives in `index-diagnostics-center-query.test.tsx`, reducing the main diagnostics center UI test from the 495-line danger zone to 336 lines while preserving query explain, backend event payload, timeline ordering, and UI latency evidence coverage.
- [x] Frontend index diagnostics controller fixtures now live in `index-diagnostics-controller-test-fixtures.ts`, reducing `use-index-diagnostics-controller.test.tsx` from the 494-line danger zone to 305 lines while preserving health/task/current-file readiness, SDK indexing, rebuild polling, and active-file refresh coverage.
- [x] Search Everywhere / Double Shift entity query storage now lives in `workspace_index_entity_store_service`, reducing `workspace_index_entity_query_service` from 435 lines to 168 lines. The query service now owns scope orchestration and ranking, while SQLite row loading, freshness projection, legacy fallback loading, and symbol-to-candidate mapping have a dedicated store boundary.
- [x] Frontend index diagnostics projection/status summary logic now lives in `index-diagnostics-controller-model`, reducing `use-index-diagnostics-controller` from 424 lines to 392 lines and keeping the hook focused on side effects, polling, and UI state transitions.
- [x] Editor change coalescing phase 9 is now recorded complete except for the optional commit step. Large-document CodeMirror changes are coalesced through `createEditorChangeDispatcher`, while normal documents remain synchronous; focused editor tests prove rapid large-document edits emit one `onChange` payload on the next animation frame.
- [x] Navigation transaction phase 2 is now recorded complete except for the optional commit step. File-open navigation uses `createNavigationTransactionRuntime` so rapid search-result/file-switch requests keep only the latest success/failure visible and avoid caching stale document content.
- [x] Search Everywhere controller coverage is now split by responsibility. Shared harness utilities live in `search-everywhere-controller-fixtures`, text-search/find-mode cases live in `use-search-everywhere-text-search.test`, and the main controller test is reduced from 519 lines to 264 lines while preserving debounce, stale-result, cancellation, latency, preview, and backend text-search coverage.
- [x] Editor large-file budget phase 7 is now recorded complete except for the optional commit step. Large documents enter explicit budget mode and skip parser/folding/hover/typing-completion/git-blame extension work while preserving core editing, selection, search, and jump behavior.
- [x] Editor selection payload budget phase 8 is now recorded complete except for the optional commit step. Selection changes keep caret line/column updates but omit huge selected text payloads before they enter React state, completion, or search controllers.
- [x] Frontend workspace index query API now has command-name regression coverage proving indexed candidate and file-symbol surfaces invoke only readiness-envelope Tauri commands. Legacy item-array command names remain backend compatibility wrappers and are no longer part of the frontend query API path.
- [x] Backend raw indexed candidate, entity, file-symbol, and raw Search Everywhere baseline helpers are now crate-only. This keeps the facade/readiness commands as the public query contract while preserving internal tests, pagination, quick-open, and the explicitly named interaction baseline fixture.
- [x] Facade search subservice and candidate-page helpers are now crate-only implementation details. Search pagination, file-symbol pagination, and text fallback remain available to command wrappers, while external query callers are funneled through `workspace_index_facade_service`.
- [x] Facade navigation and completion subservice query functions are now crate-only implementation details. Definition, usages, and completion stay publicly available through the readiness-envelope wrappers in `workspace_index_facade_service`, reducing the chance of future callers bypassing event recording or envelope projection.
- [x] Facade envelope projection, event recording, explain construction, and readiness gate helpers are now crate-only implementation details. Command wrappers and facade subservices still share one implementation, but crate-external callers see the facade service instead of helper-level APIs.
- [x] Facade subservice modules are now crate-only in `services/mod.rs`. `workspace_index_facade_service` remains the public facade module, while search/navigation/completion/envelope/event/explain/readiness helpers are internal implementation modules.
- [x] Candidate-page module visibility and definition candidate fallback helper visibility are now crate-only. Search/file-symbol pagination and indexed definition fallback resolution remain available through the query/facade stack without presenting helper-level APIs.
- [x] Entity-query module visibility is now crate-only. File/class/symbol/API entity lookup stays available to query service and facade search without presenting a helper-level crate-external service module.
- [x] Text-candidate module and helper visibility are now crate-only. Search Everywhere text-scope candidates stay available through query service and facade search without presenting a helper-level crate-external module.
- [x] Search preview render budget phase 3 is now recorded complete except for the optional commit step. Full-file text preview renders a bounded line window around the hit while preserving total line count and fallback context preview, keeping large-file search result selection responsive.
- [x] Search preview payload budget phase 5 is now recorded complete except for the optional commit step. Preview window extraction scans full content without allocating a full line array, handles CRLF and empty content, and keeps the loading-context fallback behavior intact.
- [x] Search preview IO budget phase 6 is now recorded complete except for the optional commit step. Search result preview reads are cache-only for unopened files, while already-open/active documents can still provide full preview content and full text-search fallback keeps its backend read path.
- [x] Search interaction responsiveness phase 1 is now recorded complete except for the optional commit step. Query and preview generations are owned by `SearchInteractionRuntime`, foreground invalidation clears transient preview/page-loading state, and stale backend results cannot repopulate closed or changed search sessions.
- [x] Open-file fast-path phase 4 is now recorded complete except for the optional commit step. Editor navigation activates already-loaded or cached documents from the document store without backend reads, while shared activation resets transient editor/search state consistently.
- [x] Document-store notification budget phase 10 is now recorded complete except for the optional commit step. Document writes stay synchronous, but subscriber callbacks are coalesced through a microtask per normalized path so repeated same-turn edits notify React once with the latest content.
- [x] Document dirty-state budget phase 11 is now recorded complete except for the optional commit step. The document store maintains an O(1) dirty count and Search Everywhere consumes `hasDirtyDocuments()` instead of scanning open documents before text-search routing.
- [x] Index observability event model plan is now recorded complete. Unified task/query/performance events are persisted, exposed through diagnostics and frontend API types, rendered in diagnostics timelines, and covered by targeted Rust and frontend tests.
- [x] Index parse pool foundation plan is now recorded complete. The bounded parse pool supports priority ordering, concurrent workers, per-job failure isolation, ArkTS stub parsing, config-based worker budgets, and preserves existing manager priority behavior.
- [x] Large workspace open performance plan is now recorded complete. Workspace opening uses root-only shell snapshots, background discovery follow-up tasks, durable discovery state, discovery-aware diagnostics/status copy, and regression coverage for root-only large workspace scans.
- [x] Four-layer index / dual-channel parse plan is now recorded complete. Project and SDK layers have explicit priority/channel strategy, SDK API-only scan/chunk/cache behavior, layered readiness/explain evidence, and regression coverage proving SDK indexing does not block foreground file readiness.
