# IDE-Grade Index Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve ArkLine's current readiness-aware index core into an IDE-grade indexing platform for Search Everywhere, global search, definition, usages, completion, SDK APIs, diagnostics, and future refactoring.

**Architecture:** SQLite remains the durable local index. Worker/scheduler/readiness/explain services remain the backbone. New IDE-grade capability must enter through focused backend services and readiness-aware facades; UI code should format and present results, not invent index fallback chains.

**Tech Stack:** Rust/Tauri backend, SQLite, existing workspace index services, ArkTS/ETS/TS stub parser, React/Vitest frontend, semantic worker.

---

## Long-Term Objective

Build ArkLine's index system into the IDE knowledge layer that mature IDEs rely on:

- one durable SQLite-backed fact store for files, symbols, references, SDK APIs, content, and health;
- one readiness-aware query facade for Search Everywhere, global search, definition, usages, completion, and diagnostics;
- one scheduler/state-machine layer that makes indexing interruptible, generation-safe, observable, and large-project friendly;
- one explicit health/repair surface so missing results can be explained and repaired instead of guessed;
- one regression harness that protects large-project behavior from performance and correctness regressions.

Success means the user can open a large HarmonyOS/ArkTS project and still get predictable Double Shift results, Ctrl+Click targets, Find Usages, SDK/API completion, global content search, and truthful readiness states while indexing is still in progress.

## Current Objective

Active goal for the next implementation sessions:

> Finish the index core architecture before expanding UI polish: state-machine-backed scheduling first, then health/repair, then large-project regression gates.

The immediate target is **Stage 4: Add Scheduler State Machine**. Stages 1-3 are functionally complete for the current slice; remaining work there should be treated as follow-up quality improvements, not blockers for scheduler work.

## Success Gates

- Correctness: stale worker results cannot overwrite newer index generations.
- Responsiveness: foreground navigation/completion tasks can be prioritized over background refresh.
- Observability: task state, readiness, partial/failed reasons, and queue state are visible through backend contracts.
- Durability: index facts remain in SQLite; memory holds only hot caches, queues, active generations, and transient worker state.
- Maintainability: every new Rust service/test file stays below 500 lines or is split before merging more behavior.
- Regression safety: each slice adds focused backend tests first, then frontend tests only when UI/API contracts change.

## Baseline

Completed foundations:

- SQLite-backed content, file, symbol, SDK/API, stub, dependency, readiness, explain, diagnostics, and task-status services.
- Search Everywhere scopes, global text search, indexed completion, Ctrl+Click readiness/explain, SDK indexing, and maintenance commands.
- Symbol-resolution domain with `workspace_resolved_symbols` and `workspace_unresolved_symbols`.
- Import and re-export alias binding through `target_symbol_id`.
- Definition fallback through resolved-symbol queries, including barrel exports.
- Reference domain with `workspace_symbol_references`.
- Reference indexing for identifier usages linked from import aliases to target declarations.
- Readiness-aware Find Usages facade started via `workspace_usage_query_service.rs`.

Original gaps tracked by the phase checklist:

- Symbol binding needed deeper scopes, members, namespaces, and SDK/project identity merging.
- Reference extraction needed declarations, member access, local scopes, SDK APIs, and confidence classes beyond alias resolution.
- Search, definition, usages, completion, and health needed one shared facade/readiness contract.
- Completion needed expected-type context, object-member context, import metadata, semantic de-duplication, and stable ranking.
- Scheduler needed explicit state transitions, cancellation, superseding, priority, progress domains, and backpressure.
- Large-project behavior needed regression fixtures and measurable latency gates.

## Guardrails

- New Rust files must stay below 500 lines; split before approaching the limit.
- Avoid adding more logic to existing large frontend files except small compatibility glue.
- Every new user-facing index query returns `WorkspaceIndexQueryEnvelope<T>` or is a compatibility wrapper.
- SQLite stores durable facts; memory is only for hot caches, queues, and active sessions.
- UI must not hide stale, partial, missing, or blocked readiness.
- Prefer stable symbol identity over string matching whenever identity exists.
- Add backend tests first; add frontend tests only when UI contracts change.

## Target Services

- `workspace_symbol_resolution_service.rs`: bind declarations, imports, exports, namespaces, members, SDK APIs, and unresolved facts.
- `workspace_reference_index_service.rs`: persist references and connect them to resolved declarations.
- `workspace_usage_query_service.rs`: resolve caret symbol to target identity and return indexed usages with readiness.
- `workspace_index_facade_service.rs`: unify definition, usages, Search Everywhere, file symbols, completion, and global search.
- `workspace_completion_semantic_service.rs`: produce semantic candidates from locals, members, imports, workspace, SDK, keywords, and snippets.
- `workspace_search_ranking_service.rs`: score files, classes, symbols, APIs, text matches, recency, and opened context.
- `workspace_index_state_machine_service.rs`: own task transitions, cancellation, superseding, priority, retry, and progress.
- `workspace_index_health_service.rs`: summarize freshness, parser failures, unresolved facts, queue health, and repair actions.

## Phase 1: Symbol Identity

Status: mostly implemented.

- [x] Add versioned `symbol_resolution` domain.
- [x] Persist resolved/unresolved symbol rows.
- [x] Resolve project declarations into stable `project:<path>:<kind>:<qualified_name>:<line>:<column>` ids.
- [x] Bind relative imports and re-exports with `target_symbol_id`.
- [x] Query resolved symbols by id, name, path, and target.
- [x] Add durable SDK member symbol ids for expressions such as `Text().width`.
- [x] Add namespace/member symbol ids for project expression chains beyond indexed declarations.
- [x] Add SDK/project identity merge rules so SDK APIs and project wrappers can share definition/usages semantics.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_service_tests workspace_symbol_resolution_query_service_tests
```

## Phase 2: Reference And Usages

Status: first slice implemented; active next area.

- [x] Add versioned `reference` domain.
- [x] Persist `workspace_symbol_references`.
- [x] Index identifier usages in source files.
- [x] Link import-alias usages to declaration `symbol_id`.
- [x] Query references by `symbol_id`.
- [x] Add readiness-aware usage query facade.
- [x] Expose `query_usages_with_readiness` to Tauri and frontend API.
- [x] Index declaration references separately from usage references.
- [x] Keep Find Usages focused on usage rows while allowing declaration-caret lookup.
- [x] Index first-slice member access references with owner context and `unresolvedLikely` confidence.
- [x] Resolve simple active-SDK member access references such as `Text().width` to stable SDK symbol ids.
- [x] Let Find Usages consume `memberResolved` reference facts at the caret position.
- [x] Let definition lookup consume `memberResolved` reference facts at the caret position.
- [x] Resolve same-file project member access for `const x = new Type(); x.member()` receiver context.
- [x] Resolve same-file project member access for `param: Type` receiver context.
- [x] Resolve same-file project member access for `this.field` when field type is declared.
- [x] Resolve same-file project member access for simple `function name(): Type` return assignments.
- [x] Resolve broader project class member access for scoped guard lifetimes.
- [x] Resolve broader project class member access for conservative `if/else` multi-path joins.
- [x] Track local variable references without polluting project symbol references.
- [x] Persist and expose confidence values: `exact`, `resolvedAlias`, `memberResolved`, `localScope`, `unresolvedLikely`.
- [x] Add usage grouping by file, kind, and confidence for UI panels.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests workspace_usage_query_service_tests
pnpm test -- --run tests/frontend/app-shell.test.tsx tests/frontend/language-service-api.test.ts
```

## Phase 3: Unified Facade

- [x] Create `workspace_index_facade_service.rs`.
- [x] Move definition/usages/Search Everywhere/file symbols/global search behind shared readiness and explain contracts.
  - [x] Route definition and usages through the facade.
  - [x] Route Search Everywhere through the facade backend entry.
  - [x] Route file symbols and global search through the facade.
    - [x] Route file-symbol readiness command through the facade.
    - [x] Route global search command through the facade text-search wrapper.
- [x] Return one result envelope shape containing items, readiness, confidence, and optional explain facts.
- [x] Keep old commands as compatibility wrappers until frontend migration is complete.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests workspace_index_query_service_tests
```

## Phase 4: Search Quality

- [x] Route Double Shift scopes through the unified facade: All, Files, Classes, Symbols, APIs, Text.
  - [x] Add backend facade support for Search Everywhere `All` scope.
  - [x] Add facade request support for Files, Classes, Symbols, and APIs scopes.
  - [x] Add facade request support for Text scope.
  - [x] Migrate frontend Double Shift command path to the facade wrapper.
- [x] Add ranking for exact, prefix, camel-case, fuzzy, recency, opened files, project proximity, and SDK source.
  - [x] Add deterministic file/path ranking for exact, prefix, contains, camel-case acronym, and fuzzy matches.
  - [x] Add the same lexical ranking contract to symbol, class, and API candidates.
  - [x] Add the same lexical ranking contract to text candidates.
  - [x] Add recency, opened files, and project proximity signals.
- [x] Ensure global content search uses indexed content for normal text and filesystem fallback only for regex, unsupported options, dirty documents, or missing index state.
- [x] Add partial-readiness messaging for indexed global text search.
- [x] Add large-result caps for every indexed search scope.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_search_everywhere_service_tests workspace_index_query_scope_service_tests
pnpm test -- --run tests/frontend/app-shell.test.tsx tests/frontend/workspace-text-search.test.ts
```

## Phase 5: Completion Quality

- [x] Add `workspace_completion_semantic_service.rs`.
- [x] Include ArkTS keywords: `public`, `private`, `protected`, `readonly`, `static`, `async`, `await`, `export`, `import`, `class`, `interface`, `struct`, `function`, `let`, `const`.
- [x] Include local scope, first-slice class members, imports, workspace symbols, SDK APIs, and snippets.
- [x] Add recent accept history to semantic completion ranking.
- [x] Add member-context completion for project receivers and first-slice ArkUI/SDK chains such as `Text().wi`.
- [x] Add candidate de-duplication by symbol identity.
- [x] Add import insertion metadata but do not auto-edit until an explicit apply path exists.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_completion_semantic_service_tests
pnpm test -- --run tests/frontend/completion-candidate-provider.test.ts tests/frontend/indexed-completion-model.test.ts
```

## Phase 6: Scheduler And Large Projects

- [x] Add explicit task state machine: `queued`, `running`, `cancelling`, `cancelled`, `ready`, `partial`, `failed`, `superseded`.
  - [x] Add standalone task-state enum and transition guard service.
  - [x] Add stale-generation publish guard helper.
  - [x] Use state-machine labels for queued/running/cancelled/superseded status publication.
  - [x] Use stale-generation publish guard in manager superseded-result checks.
  - [x] Wire transition guard into queued task publication for running/cancelled/superseded statuses.
  - [x] Wire transition guard into worker result publication for ready/partial/failed/superseded results.
  - [x] Keep legacy `skipped` as a compatibility result status outside the core state machine.
- [x] Add priority classes: foreground navigation/completion, visible files, changed files, background full refresh, SDK indexing.
  - [x] Add explicit scheduler priority classes for foreground navigation, foreground completion, visible files, changed files, full refresh, SDK indexing, and background work.
  - [x] Drain foreground IDE priorities before background/index maintenance priorities.
  - [x] Map open workspace, refresh workspace, changed paths, and SDK indexing to concrete IDE priority classes.
  - [x] Add manager scheduling entry points for foreground completion and visible-file indexing.
  - [x] Expose foreground completion and visible-file scheduling through Tauri commands and `WorkspaceApi`.
  - [x] Wire foreground completion scheduling from the completion candidate provider.
  - [x] Wire visible-file scheduling from workspace snapshot application.
- [x] Add stale-result protection by task generation.
  - [x] Assign monotonic generations to scheduled index tasks.
  - [x] Reject stale running results when a newer superseding task is queued.
  - [x] Cover running stale-result cases for SDK, refresh/open, and changed-path tasks.
  - [x] Add explicit cancellation token flow for interrupting superseded running tasks at worker phase boundaries.
- [x] Add bounded batches and backpressure for large workspaces.
  - [x] Add scheduler batch drain without dropping remaining queued tasks.
  - [x] Limit each manager worker tick to a bounded task batch.
  - [x] Add intra-task chunking/yielding for very large single refresh tasks through changed-path chunks and full-refresh continuation planning.
  - [x] Persist/requeue remaining full-refresh chunks across worker ticks, app-open rehydration, and final resume cleanup.
  - [x] Add manager-level queue pressure metrics for health reporting.
- [x] Add large-project regression fixture with open, search, definition, usages, completion, and incremental-refresh gates.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_state_machine_service_tests workspace_index_worker_service_tests workspace_index_large_project_tests
```

## Phase 7: Health And Refactoring

- [x] Add index health service with file count, symbol count, reference count, unresolved imports, parse failures, SDK state, and queue state.
- [x] Add repair actions: rebuild project index, rebuild SDK index, inspect excluded file, inspect parser failure.
- [x] Add rename impact query based on symbol identity.
- [x] Add call hierarchy and type hierarchy only after references and member identity are reliable.

Verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests workspace_reference_index_service_tests
pnpm test -- --run tests/frontend/workspace-api.test.ts
```

## Execution Details Archive

Historical completed slices and earlier execution notes were moved to `docs/superpowers/plans/2026-07-01-ide-grade-index-execution-details.md` so this roadmap stays below the 500-line maintainability limit. The current source of truth is the phase checklist above plus the active Stage 4 section below.

## Acceptance Criteria

- Double Shift searches files, classes, symbols, SDK APIs, and text with scoped ranking and readiness.
- Global content search returns correct indexed results and safe fallbacks.
- Ctrl+Click and Find Usages share symbol identity and explain missing targets.
- Completion includes local, member, import, workspace, SDK, keyword, and snippet candidates with stable ranking.
- Large projects keep UI responsive and expose progress, partial readiness, and repair actions.
- Index data persists across restarts and can be rebuilt or repaired by domain.
- Tests cover backend behavior and visible frontend contracts.

## Active Goal: Mature IDE Index Core

**Goal:** Finish the index core so ArkLine can behave like a durable IDE knowledge layer across Double Shift, global search, Ctrl+Click, Find Usages, completion, SDK APIs, and large-project indexing.

**Non-goals for this stage:**

- Do not build full compiler-grade type checking.
- Do not add UI-only fallbacks that bypass readiness or symbol identity.
- Do not store the whole index only in memory; durable facts stay in SQLite.
- Do not grow Rust service files beyond 500 lines.

**Definition of done:**

- Every user-facing index query has a readiness-aware backend path.
- Query behavior is deterministic under exact, prefix, contains, camel-case, and fuzzy input.
- Search Everywhere supports `All`, `Files`, `Classes`, `Symbols`, `APIs`, and `Text` with the same ranking contract where applicable.
- Completion returns keywords, locals, members, imports, workspace symbols, SDK APIs, and snippets through one semantic path.
- Scheduler state protects users from stale results during refresh, SDK apply, and large-project indexing.
- Health APIs explain missing, partial, stale, failed, and blocked index states.

### Stage 1: Finish Shared Lexical Ranking

**Files:**

- Modify: `src-tauri/src/services/workspace_search_ranking_service.rs`
- Modify: `src-tauri/src/services/workspace_search_ranking_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_symbol_index_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`
- Modify: `docs/superpowers/plans/2026-07-01-ide-grade-index-roadmap.md`

Steps:

- [x] Add a failing symbol ranking test where query `lpa` ranks `LongParserAdapter` before `LandingPage`.
- [x] Add a failing SDK API ranking test where query `tdw` ranks `TextDisplayWidth` before looser fuzzy matches.
- [x] Extract `lexical_match_score(value, query)` into `workspace_search_ranking_service.rs`.
- [x] Make file/path ranking, project symbol ranking, class ranking, and SDK API ranking call the shared scorer.
- [x] Keep path-specific bonuses inside path ranking; keep source priority inside Search Everywhere sorting.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_search_ranking_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_index_service
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_index_service_tests
git diff --check
```

Expected result: exact > prefix > contains > camel-case acronym > fuzzy is consistent across files, symbols, classes, and SDK APIs.

### Stage 2: Route Global Text Search Through The Facade

**Files:**

- Modify: `src-tauri/src/services/workspace_index_facade_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_query_service.rs`
- Modify: `src-tauri/src/services/workspace_index_text_candidate_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/app-shell.test.tsx`
- Test: `tests/frontend/workspace-text-search.test.ts`

Steps:

- [x] Add a failing facade test for `TextSearch` returning indexed text candidates with readiness.
- [x] Add a failing frontend API test proving `queryWorkspaceCandidatesWithReadiness(root, query, "text", limit)` is used for global text search when regex mode is off.
- [x] Route normal global text search through `workspace_index_text_candidate_service.rs`.
- [x] Keep filesystem fallback only for regex mode, unsupported options, dirty documents, or missing index state.
- [x] Add partial-readiness copy data to the overlay instead of silently treating incomplete empty results as complete misses.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_scope_service_tests
pnpm exec vitest run tests/frontend/app-shell.test.tsx tests/frontend/workspace-text-search.test.ts
git diff --check
```

Expected result: Ctrl+Shift+F global content search returns correct indexed content for large projects and reports readiness when results are incomplete.

### Stage 3: Complete Semantic Completion Contract

**Files:**

- Modify: `src-tauri/src/services/workspace_completion_semantic_service.rs`
- Modify: `src-tauri/src/services/workspace_completion_item_service.rs`
- Modify: `src-tauri/src/services/workspace_completion_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_completion_semantic_service_tests.rs`
- Modify: `src/components/layout/completion-candidate-provider.ts`
- Test: `tests/frontend/completion-candidate-provider.test.ts`

Steps:

- [x] Add tests for visibility keywords: `public`, `private`, `protected`, `readonly`, and `static`.
- [x] Add tests for local variables outranking workspace symbols with the same prefix.
- [x] Add tests for `receiver.` returning member candidates from project symbols.
- [x] Add tests for `receiver.` / `Text().prefix` returning SDK API member candidates without global SDK noise.
- [x] Add tests for importable workspace symbols carrying import-edit metadata without applying edits.
- [x] Add snippet candidates for common ArkTS/ArkUI constructs as low-priority candidates.
- [x] De-duplicate by stable symbol id first, then label/kind/source.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_completion_semantic_service_tests
pnpm exec vitest run tests/frontend/completion-candidate-provider.test.ts tests/frontend/indexed-completion-model.test.ts
git diff --check
```

Expected result: completion quality no longer depends on disconnected fallback chains, and missing semantic readiness is visible to the caller.

### Stage 4: Add Scheduler State Machine

**Files:**

- Create: `src-tauri/src/services/workspace_index_state_machine_service.rs`
- Create: `src-tauri/src/services/workspace_index_state_machine_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_task_status_service.rs`
- Modify: `src-tauri/src/lib.rs`

Steps:

- [x] Define task states: `queued`, `running`, `cancelling`, `cancelled`, `ready`, `partial`, `failed`, and `superseded`.
- [x] Add transition tests for normal lifecycle, cancellation/superseding, terminal-state rejection, and stale generation rejection.
- [x] Add standalone `workspace_index_state_machine_service.rs` and register its test module.
- [x] Make queued/running/cancelled/superseded status labels come from the state-machine service.
- [x] Replace manager's direct stale-generation comparison with `should_publish_task_result`.
- [x] Add `task_status_from_state_transition` for guarded task-status publication.
- [x] Use `task_status_from_state_transition` for `queued -> running`, `queued -> cancelled`, and `queued -> superseded`.
- [x] Use a guarded result-status adapter for `running -> ready`, `running -> partial`, `running -> failed`, and `running -> superseded`.
- [x] Make an explicit product/architecture decision for the compatibility `skipped` result status.
- [x] Define priority classes: foreground navigation, completion, visible files, changed files, full refresh, and SDK indexing.
- [x] Preserve compatibility priority classes while migrating manager scheduling to IDE-specific classes.
- [x] Add manager APIs for foreground completion and visible-file indexing tasks.
- [x] Wire those manager APIs into Tauri command and frontend API contracts.
- [x] Wire those API contracts into completion and editor-visible-file call sites.
- [x] Add generation ids so stale worker results cannot publish fresh readiness.
- [x] Verify running stale-result rejection for SDK, refresh/open, and changed-path tasks.
- [x] Add explicit cancellation tokens for active worker tasks at phase boundaries.
- [x] Add bounded worker task batches so large-project indexing yields between queued tasks.
- [x] Add bounded intra-task chunks so a single large refresh can yield during scanning/indexing.
- [x] Add tests for cancellation, superseding, retry, priority order, and stale result rejection.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_state_machine_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_worker_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests
git diff --check
```

Expected result: large-project indexing becomes interruptible, progress-aware, and resistant to stale results.

### Stage 5: Add Health And Repair API

**Files:**

- Create: `src-tauri/src/services/workspace_index_health_service.rs`
- Create: `src-tauri/src/services/workspace_index_health_service_tests.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/workspace-api.test.ts`

Steps:

- [x] Report file count, symbol count, reference count, SDK API count, unresolved import count, parser failure count, and queue state.
- [x] Add repair commands for rebuild project index, rebuild SDK index, inspect excluded path, and inspect parser failure.
- [x] Add tests for healthy, partial, stale, failed, and missing SDK states.
- [x] Keep UI wording outside the backend service; backend returns structured facts.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests
pnpm test -- --run tests/frontend/workspace-api.test.ts
git diff --check
```

Expected result: developers and users can tell why a jump, search, usage, or completion result is missing instead of guessing.

### Stage 6: Large-Project Regression Harness

**Files:**

- Create: `src-tauri/src/services/workspace_large_project_index_tests.rs`
- Modify: `src-tauri/src/services/workspace_large_fixture_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `docs/superpowers/plans/2026-07-01-ide-grade-index-roadmap.md`

Steps:

- [x] Generate a deterministic fixture with many files, classes, symbols, references, and text hits.
- [x] Add tests for open workspace, Double Shift file search, class search, symbol search, text search, definition, usages, and completion.
- [x] Add latency assertions only where the test environment can be deterministic; otherwise assert bounded batches and partial readiness.
- [x] Add a regression command list to this roadmap.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests
cargo test --manifest-path src-tauri/Cargo.toml --quiet
pnpm test -- --run tests/frontend/app-shell.test.tsx tests/frontend/workspace-text-search.test.ts tests/frontend/completion-candidate-provider.test.ts
git diff --check
```

Expected result: future changes cannot silently break large-project indexing, Search Everywhere, global text search, definition, usages, or completion.

## Execution Order For Next Sessions

1. Continue Stage 4 because scheduler correctness is now the main architectural blocker for large projects.
2. Finish manager/worker integration so task states are emitted from one guarded path instead of scattered string/status updates.
3. Add priority classes only after state transitions are centralized.
4. Add bounded batches after priority exists, so batch yielding does not starve foreground work.
5. Add Stage 5 health/repair after scheduler state is real enough to report.
6. Add Stage 6 large-project regression gates last, once scheduler and health expose stable contracts.

## Current Resume Point

Resume at **Stage 4: Add Scheduler State Machine**.

Next concrete steps:

1. Re-run `workspace_index_state_machine_service_tests` after the standalone service addition.
2. Inspect `workspace_index_manager_service.rs` and its tests around superseding/generation logic.
3. Add a failing manager test proving stale results are rejected through `should_publish_task_result`.
4. Wire the state-machine helper into manager/worker status publication with the smallest behavior-preserving change.
5. Run focused manager/worker/state-machine tests and `git diff --check`.
