# Index Query Readiness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArkLine's core queries consume layered index readiness so misses, partial results, and current-file failures identify the exact missing, stale, or failed index layer.

**Architecture:** Keep SQLite as the source of truth. Layer readiness remains the shared backend read model, while current-file readiness, Query Explain, Search Everywhere, text search, definition, usages, and completion consume that model instead of inventing parallel UI-only fallback explanations. Each slice keeps query behavior deterministic and exposes partial readiness honestly.

**Tech Stack:** Rust/Tauri backend, SQLite via `rusqlite`, existing workspace index services, React/Vitest frontend API and diagnostics tests, Cargo service tests.

---

## Execution Plan

### Task 1: Current File Discovery And Catalog Evidence

**Files:**

- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_file_readiness_service.rs`
- Modify: `src-tauri/src/services/workspace_index_file_readiness_service_tests.rs`
- Modify: `src/features/workspace/workspace-index-api-types.ts`
- Modify: `src/features/workspace/workspace-index-management-api.ts`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `tests/frontend/workspace-api.test.ts`
- Modify: `tests/frontend/index-diagnostics-center.test.tsx`

- [x] Add failing backend test proving a file discovered in `workspace_discovered_files` but not yet in `workspace_files` reports `discoveryIndex = ready`, `fileIndex = missing`, and a reason naming foreground file catalog indexing.
- [x] Add failing frontend/API test covering fallback `discoveryIndex`.
- [x] Add `discovery_index` / `discoveryIndex` to the current-file readiness contract.
- [x] Read discovery evidence from `workspace_discovered_files`.
- [x] Render `Discovery` in Current File Readiness metrics.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_file_readiness_service_tests
pnpm exec vitest run tests/frontend/workspace-api.test.ts tests/frontend/index-diagnostics-center.test.tsx
```

### Task 2: Layer-Aware Query Explain Facts

**Files:**

- Modify: `src-tauri/src/services/workspace_index_explain_service.rs`
- Modify: `src-tauri/src/services/workspace_index_explain_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_layer_readiness_service.rs`
- Modify: `src-tauri/src/services/workspace_index_layer_readiness_service_tests.rs`
- Modify: `tests/frontend/workspace-query-explain-model.test.ts`

- [x] Add failing explain tests for missing current-file fingerprint that expect facts such as `layer: discovery=ready`, `layer: fileCatalog=missing`, and `action: indexCurrentFile`.
- [x] Add explain facts for missing discovery/fileCatalog when the file has no fingerprint.
- [x] Add explain facts for missing symbol layer when a definition/symbol/completion query has file catalog evidence but lacks symbol rows.
- [x] Add explain facts for skipped content/references/sdk layers when missing.
- [x] Preserve existing `status` and `recommendedAction` values for compatibility.
- [x] Ensure recorded query events include the same layer facts in `payloadJson`.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_explain_service_tests
pnpm exec vitest run tests/frontend/workspace-query-explain-model.test.ts tests/frontend/index-diagnostics-center.test.tsx
```

### Task 3: Partial Search Gates For Search Everywhere And Text Search

**Files:**

- Modify: `src-tauri/src/services/workspace_index_facade_search_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_search_tests.rs`

- [x] Add backend facade tests proving Search Everywhere text scope returns available text results with `readiness.state = partial` when `TextIndex` is not ready.
- [x] Add text-search tests proving content-index missing is partial, not empty success.
- [x] Surface skipped layer facts in the query envelope explain array with `skipped:TextIndex:missing`.
- [x] Keep result caps and ranking behavior unchanged.
- [x] Use filesystem fallback only when the plain text query would otherwise rely on a missing indexed content layer.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
```

### Task 4: Navigation, Usages, And Completion Readiness Gates

**Files:**

- Modify: `src-tauri/src/services/workspace_index_facade_navigation_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_completion_service.rs`
- Add: `src-tauri/src/services/workspace_index_facade_readiness_gate_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_completion_tests.rs`

- [x] Add navigation tests proving missing symbols/references create layer-specific explain evidence.
- [x] Add completion tests proving missing current-file catalog evidence produces a retryable partial envelope.
- [x] Keep semantic fallback available while marking the backend readiness envelope partial.
- [x] Preserve stale generation reasons when a missing-layer gate adds additional skipped evidence.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_completion_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests
```

### Task 5: Deep-Layer Performance Follow-Up Criteria

**Files:**

- Modify: `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`
- Modify: `docs/superpowers/plans/2026-07-05-index-query-readiness-gate.md`

- [x] Record the next performance target as profiler-backed gates for stub insert, symbol resolution, reference refresh, and dependency graph updates.
- [x] Define that further deep-layer work must keep first editor readiness under the existing large-project target and deep continuation ticks bounded.
- [x] Keep performance work separate from query readiness behavior so correctness and observability do not depend on a performance refactor.
- [x] Run:

```bash
git diff --check
```

## Completion Criteria

- Current File Readiness includes discovery/catalog evidence.
- Query Explain identifies missing, stale, partial, or failed layers.
- Search and navigation query envelopes do not hide partial readiness behind empty results.
- Completion exposes current-file readiness issues through explain evidence.
- Deep-layer performance work has explicit profiler-backed criteria for the next phase.

## Deep-Layer Performance Follow-Up Criteria

Performance work after this readiness gate must be profiler-backed. The next performance slice should target only measured hot spots in stub insert, symbol resolution, reference refresh, and dependency graph updates. It should preserve the current large-project foreground contract: opening a 10,000-file workspace should keep first editor readiness around the existing sub-second target, while deep continuation ticks remain bounded and interruptible.

Do not couple deep-layer performance changes to query correctness. Query readiness and explain behavior should remain valid even if deep-layer work is slow, partial, stale, or failed.
