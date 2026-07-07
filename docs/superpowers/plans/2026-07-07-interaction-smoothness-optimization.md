# Interaction Smoothness Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArkLine feel responsive on medium and large projects by protecting typing, search, file-open, and navigation paths from background indexing and large result rendering.

**Architecture:** Add observability first, then move expensive global text search work out of the WebView, then connect UI activity to backend indexing backpressure. Each phase must preserve current index correctness and keep source files under 500 lines.

**Tech Stack:** React, TypeScript, Tauri invoke API, Rust services, SQLite content index, existing workspace index diagnostics, Vitest, Cargo tests.

---

## File Structure

- Create `src/features/performance/ui-latency-monitor.ts`: samples UI event-loop lag and interaction latency without rendering UI.
- Create `tests/frontend/ui-latency-monitor.test.ts`: verifies lag samples, thresholds, and retention.
- Modify `src/components/layout/AppShell.tsx`: wires monitor events into existing diagnostics/status paths without owning measurement logic.
- Create `src-tauri/src/services/workspace_text_search_cancellation_service.rs`: owns text-search generation staleness checks.
- Create `src-tauri/src/services/workspace_text_search_cancellation_service_tests.rs`: verifies generation discard and cancellation boundaries.
- Modify `src-tauri/src/commands/workspace.rs`: exposes backend text-search query command.
- Modify `src/features/workspace/workspace-index-query-api.ts`: routes desktop global text search to backend command.
- Modify `src/components/layout/use-search-everywhere-controller.ts`: cancels stale searches, renders partial batches, and stops using frontend full-workspace scanning in desktop runtime.
- Create `src-tauri/src/services/workspace_index_ui_activity_service.rs`: tracks recent UI activity windows for input, search, navigation, and file-open.
- Create `src-tauri/src/services/workspace_index_ui_activity_service_tests.rs`: verifies active windows and expiration.
- Modify `src-tauri/src/services/workspace_index_worker_budget_service.rs`: lowers background deep-layer budget when UI activity is active.
- Modify `src-tauri/src/services/workspace_index_worker_service.rs`: reads the UI activity budget helper only through focused service functions.
- Create `src-tauri/src/services/workspace_interaction_perf_fixture_tests.rs`: ignored real/large fixture performance gate for open, search, navigation, and UI-latency evidence.
- Update `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`: records the new smoothness gates and current benchmark numbers.

## Phase 0: Observability First

### Task 1: UI Latency Monitor

**Files:**
- Create: `src/features/performance/ui-latency-monitor.ts`
- Create: `tests/frontend/ui-latency-monitor.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for:
- a 120ms event-loop gap creates a lag sample;
- samples are capped to the newest 20 entries;
- interaction latency records preserve `kind`, `startedAt`, `durationMs`, and `label`.

Run:

```bash
pnpm exec vitest run tests/frontend/ui-latency-monitor.test.ts
```

Expected: fails because `ui-latency-monitor.ts` does not exist.

- [x] **Step 2: Implement monitor model**

Create a pure model with:
- `createUiLatencyMonitor(options)`;
- `recordInteraction(kind, label, startedAt, endedAt)`;
- `recordHeartbeat(now)`;
- `getSnapshot()`.

Threshold defaults:
- event-loop lag: `100ms`;
- retained samples: `20`;
- ignored normal heartbeat interval: `50ms`.

- [x] **Step 3: Verify**

Run:

```bash
pnpm exec vitest run tests/frontend/ui-latency-monitor.test.ts
wc -l src/features/performance/ui-latency-monitor.ts tests/frontend/ui-latency-monitor.test.ts
```

Expected: tests pass and each file is under 500 lines.

### Task 2: Surface Latency Evidence In Diagnostics

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: existing diagnostics status model files discovered by `rg -n "queryExplain|diagnostics|recent" src/components src/features`
- Test: frontend tests touching diagnostics/query explain rendering.

- [x] **Step 1: Add a failing frontend test**

Test that a recorded `globalSearch` interaction over 300ms appears in the diagnostics snapshot or status evidence list.

Run the focused Vitest command for the touched diagnostics test.

- [x] **Step 2: Wire monitor without adding AppShell ownership**

Keep AppShell as orchestration only:
- create the monitor through a focused hook or model;
- record `openFile`, `globalSearch`, `searchEverywhere`, `goToDefinition`, and `completion`;
- expose newest evidence to diagnostics.

- [x] **Step 3: Verify**

Run:

```bash
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
pnpm build
wc -l src/components/layout/AppShell.tsx
```

Expected: tests pass, build passes, `AppShell.tsx` stays under 500 lines.

## Phase 1: Global Text Search Must Not Block Input

### Task 3: Cancellable Text Search Execution Boundary

**Files:**
- Modify: `src-tauri/src/services/workspace_text_search_service.rs`
- Create: `src-tauri/src/services/workspace_text_search_cancellation_service.rs`
- Create: `src-tauri/src/services/workspace_text_search_cancellation_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing Rust tests**

Tests must prove:
- a newer query generation marks an older generation stale;
- filesystem text search stops between files when the cancellation token is stale;
- each returned batch still respects the request limit;
- regex errors return an explicit invalid-query result;
- result rows contain path, line, column, preview range, and context lines.

Run:

```bash
cd src-tauri
cargo test workspace_text_search_cancellation_service_tests
cargo test workspace_text_search_service_tests
```

Expected: cancellation tests fail until the focused cancellation service exists.

- [x] **Step 2: Implement cancellation boundary**

Reuse existing backend text-search services instead of adding a duplicate command:
- `workspace_text_search_service.rs` remains the filesystem scanner;
- `workspace_index_facade_search_service.rs` remains the indexed/fallback router;
- new cancellation helper owns generation comparison;
- filesystem scanning checks cancellation between files and before reading a large file;
- stale searches return an empty result with the original parsed query.

- [x] **Step 3: Verify**

Run:

```bash
cd src-tauri
cargo test workspace_text_search_cancellation_service_tests
cargo test workspace_text_search_service_tests
wc -l src-tauri/src/services/workspace_text_search_service.rs src-tauri/src/services/workspace_text_search_cancellation_service.rs src-tauri/src/services/workspace_text_search_cancellation_service_tests.rs
```

Expected: tests pass and files are under 500 lines.

### Task 4: Route Ctrl+Shift+F To Backend Search

**Files:**
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-index-query-api.ts`
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Test: `tests/frontend/use-search-everywhere-controller.test.tsx`

- [x] **Step 1: Add failing frontend tests**

Tests must prove:
- desktop runtime calls backend `searchWorkspaceText` instead of frontend full-workspace scan;
- stale search results are ignored;
- query input updates immediately before results arrive;
- selected text seeds the search box.

Run:

```bash
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
```

Expected: fails until controller routing changes.

- [x] **Step 2: Implement routing**

Rules:
- if Tauri backend search exists, do not call `searchWorkspaceText` frontend scanner for workspace-wide search;
- keep frontend scanner only for browser/demo fallback;
- clear preview while result batch is changing;
- read preview lazily for selected result only.

- [x] **Step 3: Verify**

Run:

```bash
pnpm exec vitest run tests/frontend/use-search-everywhere-controller.test.tsx
pnpm build
```

Expected: tests and build pass.

## Phase 2: UI Activity Backpressure For Background Indexing

### Task 5: UI Activity Runtime

**Files:**
- Create: `src-tauri/src/services/workspace_index_ui_activity_service.rs`
- Create: `src-tauri/src/services/workspace_index_ui_activity_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing tests**

Tests must prove:
- `searchInput` activity stays active for 750ms;
- `fileOpen` activity stays active for 1500ms;
- expired activity no longer lowers background budgets;
- overlapping activities extend the active window.

Run:

```bash
cd src-tauri
cargo test workspace_index_ui_activity_service_tests
```

Expected: fails until service exists.

- [x] **Step 2: Implement runtime**

Expose:
- `record_ui_activity(kind, now_ms)`;
- `current_ui_activity(now_ms)`;
- `is_latency_sensitive(now_ms)`.

Keep this service independent from React and independent from SQLite.

- [x] **Step 3: Verify**

Run:

```bash
cd src-tauri
cargo test workspace_index_ui_activity_service_tests
wc -l src-tauri/src/services/workspace_index_ui_activity_service.rs
```

Expected: tests pass and file is under 500 lines.

### Task 6: Lower Background Deep-Layer Budget During UI Activity

**Files:**
- Modify: `src-tauri/src/services/workspace_index_worker_budget_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Test: `src-tauri/src/services/workspace_index_worker_budget_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_worker_budget_integration_tests.rs`

- [x] **Step 1: Add failing tests**

Tests must prove:
- normal background deep budget remains `128`;
- latency-sensitive activity lowers deep budget to `32`;
- foreground navigation budget is never lowered;
- partial result message reports deferred counts.

Run:

```bash
cd src-tauri
cargo test workspace_index_worker_budget_service_tests
cargo test workspace_index_worker_budget_integration_tests
```

Expected: fails until budget helper accepts UI activity state.

- [x] **Step 2: Implement budget helper**

Add a helper that calculates effective deep-layer budget from:
- task priority;
- configured background mode;
- current UI activity state.

Do not add heavy branching to `workspace_index_worker_service.rs`; keep worker under 500 lines.

- [x] **Step 3: Verify**

Run:

```bash
cd src-tauri
cargo test workspace_index_worker_budget_service_tests
cargo test workspace_index_worker_budget_integration_tests
cargo test workspace_index_worker_service_tests
wc -l src-tauri/src/services/workspace_index_worker_service.rs src-tauri/src/services/workspace_index_worker_budget_service.rs
```

Expected: tests pass and every file stays under 500 lines.

## Phase 3: Real-Project Smoothness Gate

### Task 7: Interaction Performance Fixture

**Files:**
- Create: `src-tauri/src/services/workspace_interaction_perf_fixture_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`

- [x] **Step 1: Write ignored performance test**

The test reads `ARKLINE_PROFILE_ROOT` and measures:
- open workspace lightweight index time;
- first file readiness time;
- Double Shift first result time;
- Ctrl+Shift+F first batch time;
- foreground navigation readiness while background deep indexing is running.

Run:

```bash
cd src-tauri
ARKLINE_PROFILE_ROOT=/path/to/project cargo test verifies_real_project_interaction_smoothness -- --ignored --nocapture
```

Expected: ignored unless `ARKLINE_PROFILE_ROOT` is set.

- [x] **Step 2: Add thresholds**

Initial non-blocking thresholds:
- open lightweight index under `800ms`;
- first search batch under `500ms`;
- foreground current-file readiness under `1000ms`;
- background deep task must report progress or deferred reason within `1500ms`.

Thresholds are report-first in this phase. Do not fail CI on local machine variance unless `ARKLINE_STRICT_PERF=1`.

- [x] **Step 3: Record baseline**

Run against the chosen medium project:

```bash
cd src-tauri
ARKLINE_PROFILE_ROOT=/Users/liuhui/Documents/code/<medium-project> cargo test verifies_real_project_interaction_smoothness -- --ignored --nocapture
```

Update the goal tracker with the measured numbers and the slowest stage.

## Phase Order

1. Phase 0 must land first. It tells us whether later changes improve real interaction latency.
2. Phase 1 is the highest user-visible fix because search input currently risks JS-side full-workspace scanning.
3. Phase 2 protects typing, file open, and navigation from background deep indexing.
4. Phase 3 prevents regressions and gives us honest medium-project evidence.

## Completion Criteria

- Search input remains responsive while a medium project is indexing.
- Ctrl+Shift+F first result batch appears without freezing the WebView.
- Opening a file does not wait for background deep-layer indexing.
- Background index status explains progress, deferred work, and active UI backpressure.
- Real-project smoothness benchmark is recorded in the local index goal tracker.
- All touched source files remain under 500 lines.

## Verification Bundle

Run before claiming the full goal complete:

```bash
pnpm exec vitest run tests/frontend/ui-latency-monitor.test.ts tests/frontend/use-search-everywhere-controller.test.tsx
pnpm build
cd src-tauri
cargo test workspace_text_search_cancellation_service_tests
cargo test workspace_index_ui_activity_service_tests
cargo test workspace_index_worker_budget_service_tests
cargo test workspace_index_worker_budget_integration_tests
cargo test workspace_index_worker_service_tests
git diff --check
```

Optional real-project run:

```bash
cd src-tauri
ARKLINE_PROFILE_ROOT=/Users/liuhui/Documents/code/<medium-project> cargo test verifies_real_project_interaction_smoothness -- --ignored --nocapture
```
