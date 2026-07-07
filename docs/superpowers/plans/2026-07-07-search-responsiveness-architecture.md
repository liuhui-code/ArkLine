# Search Responsiveness Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArkLine's query panels follow mature IDE behavior: search may be slow, but typing, deleting, closing, and jumping never wait for search.

**Architecture:** Split search into an instant UI input layer, cancellable query sessions, backend blocking-pool execution, partial result delivery, deferred preview work, and foreground navigation isolation. Search requests carry generations; stale generations must not update UI and must be cancellable in backend loops.

**Tech Stack:** React hooks and Vitest for query-panel interaction tests; Tauri v2 commands and Rust services for backend query isolation; existing SQLite workspace index and filesystem fallback search.

---

## Phase 0: Frontend Input Budget And Stale Result Guard

**Files:**
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Test: `tests/frontend/use-search-everywhere-controller.test.tsx`

- [x] Add a minimum query length of `2` for Search Everywhere and Find in Files.
- [x] Invalidate active search and preview generations immediately when query text changes.
- [x] Keep empty or one-character queries local: clear results without calling backend.
- [x] Add Vitest coverage for single-character input, rapid typing/deleting, stale slow queries, and empty native text search.

Run:

```bash
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
pnpm build
git diff --check
```

Expected: tests pass; input changes do not call backend until the debounced query has at least two non-space characters.

## Phase 1: Backend Query Thread Isolation

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`
- Test: `src-tauri/src/commands/workspace_tests.rs`

- [x] Convert query commands that can hit SQLite or filesystem fallback to `async fn`.
- [x] Clone runtime state before crossing into `tauri::async_runtime::spawn_blocking`.
- [x] Run heavy query bodies in `spawn_blocking`:
  - `query_workspace_candidates`
  - `query_workspace_candidates_with_readiness`
  - `search_workspace_text`
- [x] Keep command signatures and frontend API names unchanged.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_text_search_cancellation_service_tests
pnpm build
```

Expected: Tauri command handlers return futures quickly instead of doing heavy search work inline.

## Phase 2: Unified Search Session Cancellation

**Files:**
- Create: `src-tauri/src/services/workspace_search_session_service.rs`
- Create: `src-tauri/src/services/workspace_search_session_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-index-api-types.ts`
- Modify: `src/features/workspace/workspace-default-core-api.ts`
- Modify: `src/features/workspace/workspace-api-contract.ts`
- Modify: `src/components/layout/use-search-everywhere-controller.ts`

- [x] Add a backend runtime that stores latest generation per workspace and search kind.
- [x] Add command `cancel_workspace_search(root_path, generation, kind)` that advances latest generation.
- [x] Register generation at search start and check cancellation inside text-search fallback.
- [x] Frontend calls cancellation when query changes, overlay closes, mode changes, or query is cleared.
- [x] Keep cancellation best-effort: errors must not block UI close/input.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_search_session_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_text_search_service::tests
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
```

Expected: stale backend work stops early and stale results never reach the UI.

## Phase 3: First Batch Results And Partial Status

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_text_search_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_search_service.rs`
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Modify: `src/components/layout/SearchEverywherePanel.tsx`

- [x] Extend search response with `partial`, `searchedFiles`, and `limitReached`.
- [x] Cap first batch at `20-50` rows depending on panel mode.
- [ ] Return partial results when time budget is exceeded instead of scanning everything.
- [x] Show `Partial` status without blocking input.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_text_search_service
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t "search"
```

Expected: large text search returns a bounded first batch and exposes partial readiness.

## Phase 4: Deferred And Cancellable Preview

**Files:**
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Modify: `tests/frontend/use-search-everywhere-controller.test.tsx`

- [x] Add 150-250ms preview debounce after selected result changes.
- [x] Cancel preview generation on query changes, result selection changes, and panel close.
- [ ] Read only enough content for preview once backend provides line/context data.

Run:

```bash
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
```

Expected: arrow-key or mouse-wheel navigation does not trigger unbounded file reads.

## Phase 5: Foreground Navigation Isolation

**Files:**
- Modify: `src/components/layout/use-editor-navigation.ts`
- Modify: `src/components/layout/use-editor-surface-controller.ts`
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Test: `tests/frontend/use-editor-navigation.test.tsx`
- Test: `tests/frontend/use-editor-surface-controller.test.tsx`
- Test: `tests/frontend/use-search-everywhere-controller.test.tsx`

- [x] Search panel close must invalidate search/preview before calling navigation.
- [x] File opening remains latest-request-wins.
- [x] Enter/click jump does not wait for search result completion.
- [x] Old openFile responses must not cache stale file content.

Run:

```bash
pnpm exec vitest run tests/frontend/use-editor-navigation.test.tsx tests/frontend/use-editor-surface-controller.test.tsx tests/frontend/use-search-everywhere-controller.test.tsx
```

Expected: search slowdown cannot block jump application or overwrite the latest editor target.

## Phase 6: Real Interaction Performance Gate

**Files:**
- Modify: `src-tauri/src/services/workspace_interaction_perf_fixture_tests.rs`
- Modify: `tests/frontend/use-search-everywhere-controller.test.tsx`
- Modify: `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`

- [x] Add local performance gate for 100 rapid input changes, 100 deletes, Esc close, click close, and Enter jump.
- [x] Record UI latency samples for search close and jump.
- [x] Keep strict failure opt-in with `ARKLINE_STRICT_PERF=1`.

Run:

```bash
ARKLINE_PROFILE_ROOT=/Users/liuhui/Documents/code/ArkLine cargo test --manifest-path src-tauri/Cargo.toml verifies_real_project_interaction_smoothness -- --ignored --nocapture
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
```

Expected: input, delete, close, and jump remain responsive even while search work is pending.

## Current Priority

Execute Phase 1 and Phase 2 first. Phase 0 prevents the first-character freeze trigger; Phase 1/2 are required so large-project backend work cannot keep the app from accepting input, delete, close, or jump actions.
