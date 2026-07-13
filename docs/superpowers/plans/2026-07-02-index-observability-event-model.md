# Index Observability Event Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first slice of a unified index observability event model so index task lifecycle evidence is persisted and queryable for diagnostics.

**Architecture:** Add a narrow Rust event model and SQLite-backed event log beside the existing task journal. Task status remains the compatibility API, while every task status write also emits a normalized event that future diagnostics, query explain, stalled detection, and timeline UI can share.

**Tech Stack:** Rust, rusqlite, serde, Tauri command models, Vitest TypeScript type coverage.

---

### Task 1: Event Model And Storage

**Files:**
- Create: `src-tauri/src/services/workspace_index_event_service.rs`
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/services/workspace_index_event_service_tests.rs`

- [x] Add `WorkspaceIndexEvent` with `event_id`, `root_path`, `scope`, `kind`, `phase`, `severity`, `message`, `task_id`, `generation`, `payload_json`, `created_at`.
- [x] Add `workspace_index_events` table and indexes by `(root_path, created_at)` and `(root_path, task_id)`.
- [x] Add `store_index_event`, `load_recent_index_events`, and `event_from_task_status`.
- [x] Verify event roundtrip and limit ordering with `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_event_service_tests`.

### Task 2: Bridge Existing Task Lifecycle

**Files:**
- Modify: `src-tauri/src/services/workspace_index_task_journal_service.rs`
- Test: `src-tauri/src/services/workspace_index_task_journal_service_tests.rs`

- [x] When `store_task_status` persists a task status, emit the matching unified event in the same SQLite store.
- [x] Keep task journal semantics unchanged so existing status bar and task watchers keep working.
- [x] Verify queued, running, ready, partial, failed, skipped, and superseded statuses map to useful event phases and severities.

### Task 3: Diagnostics Read Model

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Test: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/workspace-api.test.ts`

- [x] Add `recent_events` to `WorkspaceIndexDiagnostics`.
- [x] Load recent events from the unified event log in diagnostics.
- [x] Mirror the type in the frontend workspace API.
- [x] Verify diagnostics includes task lifecycle evidence after a refresh.

### Task 4: Verification

**Files:**
- Existing changed files only.

- [x] Run targeted Rust tests for event, journal, diagnostics, manager.
- [x] Run frontend workspace API tests.
- [x] Run `pnpm build`.
- [x] Report remaining gaps clearly: query explain events, heartbeat/stalled events, and timeline UI are next phases.

Actual verification:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_event_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_task_journal_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_diagnostics_event_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_diagnostics_service_tests
./node_modules/.bin/vitest run tests/frontend/workspace-api.test.ts tests/frontend/workspace-index-event-api.test.ts tests/frontend/index-diagnostics-center.test.tsx tests/frontend/index-diagnostics-center-query.test.tsx tests/frontend/index-diagnostics-model.test.ts tests/frontend/use-index-diagnostics-controller.test.tsx
```

All targeted Rust and frontend tests passed. Later tasks in this plan already closed the originally listed remaining gaps: query explain events, heartbeat/stalled status, and timeline UI.

### Task 5: Query Explain Events

**Files:**
- Modify: `src-tauri/src/services/workspace_index_explain_service.rs`
- Modify: `src-tauri/src/services/workspace_index_explain_service_tests.rs`
- Modify: `src-tauri/src/commands/workspace_index.rs`

- [x] Keep pure `explain_workspace_index_query` for deterministic query reasoning.
- [x] Add `explain_and_record_workspace_index_query` as the command-facing wrapper.
- [x] Convert explain results into unified events with `scope=query`.
- [x] Map normal misses to `phase=miss` and SDK/stale readiness failures to `phase=blocked`.
- [x] Store request location, facts, status, and recommended action in event payload JSON.
- [x] Use high-entropy query event ids so rapid repeated explain calls do not overwrite evidence.

### Task 6: Index Diagnostics Center MVP

**Files:**
- Create: `src-tauri/src/services/workspace_index_file_readiness_service.rs`
- Create: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `src-tauri/src/commands/workspace_index.rs`
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/ShellStatusBar.tsx`
- Modify: `src/styles/app.css`

- [x] Add current-file readiness read model for FileIndex, ContentIndex, SymbolIndex, parser status, indexed generation, and feature availability.
- [x] Expose readiness through `get_workspace_index_file_readiness`.
- [x] Add status bar Index button that opens diagnostics.
- [x] Add Index Diagnostics Center with Processes / Queue, Current File Readiness, Query Explain, Health / Storage, and Performance Timeline placeholder.
- [x] Show recent unified query events in the Query Explain section.
- [x] Keep timeline honest with `No timeline events yet` until heartbeat/duration events exist.

### Task 7: Heartbeat And Stalled Task Visibility

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_task_status_service.rs`
- Modify: `src-tauri/src/services/workspace_index_task_journal_service.rs`
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Create: `src-tauri/src/services/workspace_index_status_projection_service.rs`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `src/features/workspace/workspace-api.ts`

- [x] Add `last_heartbeat_at` and `stalled` fields to task status.
- [x] Persist heartbeat and stalled flags in the task journal with schema migration columns.
- [x] Project current running tasks as stalled after 60 seconds without a heartbeat.
- [x] Keep persisted orphan running tasks filtered out after restart.
- [x] Show `Index: Stalled, N task(s) > 60s` in the status bar.
- [x] Show stalled status and last heartbeat in the Diagnostics Center process table.
- [x] Keep manager under the 500-line maintenance limit by moving status projection into a focused service.

### Task 8: Performance Timeline From Unified Events

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `src/styles/app.css`

- [x] Add `WorkspaceIndexTimelineItem` to diagnostics.
- [x] Project recent unified events into a stable timeline read model.
- [x] Compute per-task phase duration from the previous event for the same task.
- [x] Render Performance Timeline as a real diagnostics list with severity, title, message, and duration.
- [x] Keep the timeline UI dense and stable, aligned with IDE diagnostics panels.

### Task 9: Storage Size Evidence

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`

- [x] Add `db_size_bytes` / `dbSizeBytes` to diagnostics.
- [x] Read SQLite catalog file size from `.arkline/index/workspace-catalog.sqlite`.
- [x] Show formatted DB size in Health / Storage instead of a placeholder.
- [x] Keep fallback diagnostics complete outside the desktop runtime.

### Task 10: Latest Error And Explain Status

**Files:**
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] Populate `last_error` from the latest unified event with `severity=error`.
- [x] Populate `last_explain_status` from the latest unified query event phase.
- [x] Show `Last error` and `Last explain` in Health / Storage.
- [x] Keep the values derived from the unified event stream instead of introducing a second diagnostics source.

### Task 11: Parser Failure Details

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`

- [x] Add top parser failures to the diagnostics read model.
- [x] Reuse existing parser failure inspection service instead of duplicating SQL.
- [x] Show file, line, column, and message in Diagnostics Center.
- [x] Keep fallback diagnostics complete outside the desktop runtime.

### Task 12: Unresolved Import Details

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`

- [x] Add unresolved imports to the diagnostics read model.
- [x] Reuse existing unresolved import inspection service instead of duplicating SQL.
- [x] Show source file, line, column, and missing module in Diagnostics Center.
- [x] Keep fallback diagnostics complete outside the desktop runtime.

### Task 13: Queue Pressure In Diagnostics

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`

- [x] Add `queue_pressure` / `queuePressure` to the diagnostics read model.
- [x] Keep DB-only diagnostics usable with an empty queue pressure fallback.
- [x] Merge real runtime queue pressure in the Tauri diagnostics command.
- [x] Show pending total, workspace pending, top priority, and top task in Processes / Queue.
- [x] Keep fallback diagnostics complete outside the desktop runtime.

### Task 14: Repair Actions In Diagnostics

**Files:**
- Create: `src-tauri/src/services/workspace_index_repair_action_service.rs`
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_health_service.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `src/components/layout/AppShell.tsx`

- [x] Add shared repair-action classification for health and diagnostics.
- [x] Add `repair_actions` / `repairActions` to diagnostics.
- [x] Surface persisted resume tasks as `resumeIndexing` in diagnostics.
- [x] Show repair actions in the Diagnostics Center Health / Storage section.
- [x] Wire `Resume Indexing` to the existing desktop resume command through `WorkspaceApi`.
- [x] Wire `Rebuild Project Index`, `Rebuild SDK Index`, and `Configure SDK` as executable diagnostics actions.

### Task 15: Process Queue Readability

**Files:**
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] Show process progress as `current/total (percent%)` instead of raw counters only.
- [x] Add a Details column with task error, message, or reason.
- [x] Show active or total task duration instead of raw heartbeat timestamps.
- [x] Keep the process table compact while exposing why a task is running or blocked.

### Task 16: Stalled Task Explanation

**Files:**
- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] Render stalled task details with an explicit `No heartbeat > 60s` explanation.
- [x] Avoid duplicated heartbeat wording when the backend message already says no heartbeat.
- [x] Give stalled process rows a restrained warning treatment for fast scanning.
