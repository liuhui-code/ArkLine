# Workspace Discovery Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a maintainable discovery stage so large workspaces can enumerate files in bounded background chunks before expensive indexing.

**Architecture:** Keep `open_workspace` root-only. Add a focused discovery service that validates the root, walks directories breadth-first, honors existing workspace exclude rules, and returns a bounded file batch plus a resumable cursor. Persisted discovery state and manager/worker integration are follow-up slices.

**Tech Stack:** Rust/Tauri backend, existing `workspace_service` exclude rules, Cargo tests.

---

## Scope

This first slice creates the service boundary only:

- create `workspace_discovery_service.rs`;
- create `workspace_discovery_service_tests.rs`;
- register modules in `src-tauri/src/lib.rs`;
- keep every new or touched code file below 500 lines.

Do not persist discovery rows yet. Do not add worker integration in this slice.

## Task 1: Chunked Discovery Service

**Files:**

- Create: `src-tauri/src/services/workspace_discovery_service.rs`
- Create: `src-tauri/src/services/workspace_discovery_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing tests**

Cover:

- missing root returns an explicit error;
- excluded dependency/generated directories are counted and not returned;
- file results are bounded by `limit`;
- returned cursor resumes traversal without duplicating the first batch.

- [x] **Step 2: Verify tests fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_service_tests
```

Expected: compile failure or failing tests because the service does not exist.

- [x] **Step 3: Implement minimal service**

Expose:

```rust
pub struct WorkspaceDiscoveryCursor {
    pub pending_directories: Vec<String>,
}

pub struct WorkspaceDiscoveredFile {
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: Option<u64>,
}

pub struct WorkspaceDiscoveryChunk {
    pub files: Vec<WorkspaceDiscoveredFile>,
    pub cursor: Option<WorkspaceDiscoveryCursor>,
    pub excluded_count: usize,
    pub has_more: bool,
}

pub fn discover_workspace_chunk(
    root_path: &Path,
    cursor: Option<WorkspaceDiscoveryCursor>,
    limit: usize,
) -> Result<WorkspaceDiscoveryChunk, String>
```

Use breadth-first traversal and `workspace_service::should_exclude`.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_service_tests
wc -l src-tauri/src/services/workspace_discovery_service.rs src-tauri/src/services/workspace_discovery_service_tests.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

Expected: discovery tests pass, touched files stay below 500 lines, diff has no whitespace errors.

## Follow-Up Slices

1. [x] Add SQLite discovery schema and store service: `workspace_discovered_files`, `workspace_discovery_state`.
2. [x] Add discovery chunk runner that persists discovered files and discovery state.
3. [x] Add discovery task reason and status label boundary.
4. [x] Add worker/manager discovery follow-up scheduling after open.
5. [x] Make worker execute the first discovery chunk and persist discovered facts.
6. [x] Add discovery continuation for remaining cursor batches.
7. [x] Make full refresh consume discovered files rather than recursively scanning first.
8. [x] Surface `Discovering` separately from `Indexing` in diagnostics/status.
9. [x] Surface discovery state in index diagnostics and health APIs.
10. [x] Render discovery state in the Index Diagnostics Center.
11. [x] Delay background refresh until discovery is ready.

## Task 2: SQLite Discovery Store

**Files:**

- Create: `src-tauri/src/services/workspace_discovery_schema_service.rs`
- Create: `src-tauri/src/services/workspace_discovery_store_service.rs`
- Create: `src-tauri/src/services/workspace_discovery_store_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_schema_service.rs`
- Modify: `src-tauri/src/services/workspace_index_schema_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing store tests**

Covered discovery table migration, domain version registration, discovered file chunk upsert/load, and discovery state upsert.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_store_service_tests` before implementation and saw missing module failures.

- [x] **Step 3: Implement schema and store**

Added `workspace_discovered_files`, `workspace_discovery_state`, `replace_discovered_file_chunk`, `update_discovery_state`, and `load_discovered_files`.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_store_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_schema_service_tests
wc -l src-tauri/src/services/workspace_discovery_schema_service.rs src-tauri/src/services/workspace_discovery_store_service.rs src-tauri/src/services/workspace_discovery_store_service_tests.rs src-tauri/src/services/workspace_index_schema_service.rs src-tauri/src/services/workspace_index_schema_service_tests.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 6: Worker Discovery Execution

**Files:**

- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service_tests.rs`
- Modify: `docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md`

- [x] **Step 1: Write failing manager persistence test**

Strengthened `open_workspace_schedules_discovery_follow_up_task` so it asserts `workspace_discovery_runner_service` persists discovered files after the discovery follow-up runs.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml open_workspace_schedules_discovery_follow_up_task` and saw discovered file count remain `0`.

- [x] **Step 3: Route discovery task through worker**

Changed the `ChangedPaths` worker branch to detect `workspace-discovery`, call `run_workspace_discovery_chunk`, and return a `discovery` task result with `ready` or `partial` status.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml open_workspace_schedules_discovery_follow_up_task
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_runner_service_tests
wc -l src-tauri/src/services/workspace_index_worker_service.rs src-tauri/src/services/workspace_index_manager_service_tests.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 7: Discovery Cursor Continuation

**Files:**

- Create: `src-tauri/src/services/workspace_discovery_continuation_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_discovery_task_service.rs`
- Modify: `src-tauri/src/services/workspace_discovery_task_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_discovery_store_service.rs`
- Modify: `src-tauri/src/services/workspace_discovery_store_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_follow_up_task_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md`

- [x] **Step 1: Write failing continuation tests**

Covered discovery tasks carrying cursor directories, discovery cursor loading from SQLite state, and manager-level continuation from `partial` to `ready` across multiple drained worker batches.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_task_service_tests` and saw missing cursor API failures.

- [x] **Step 3: Implement cursor continuation**

Added `workspace_discovery_task_with_cursor`, `workspace_discovery_task_cursor`, `load_discovery_cursor`, partial discovery follow-up scheduling, and worker execution from task cursor instead of always starting at the root.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_task_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_store_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_follow_up_task_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_continuation_service_tests
wc -l src-tauri/src/services/workspace_discovery_continuation_service_tests.rs src-tauri/src/services/workspace_discovery_task_service.rs src-tauri/src/services/workspace_discovery_store_service.rs src-tauri/src/services/workspace_index_follow_up_task_service.rs src-tauri/src/services/workspace_index_worker_service.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 8: Full Refresh Consumes Discovery Catalog

**Files:**

- Modify: `src-tauri/src/services/workspace_index_full_refresh_service.rs`
- Modify: `src-tauri/src/services/workspace_index_full_refresh_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_discovery_store_service.rs`
- Modify: `src-tauri/src/services/workspace_discovery_store_service_tests.rs`
- Modify: `docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md`

- [x] **Step 1: Write failing full-refresh test**

Covered a ready discovery catalog where only `DiscoveredOnly.ets` is persisted while another disk file exists. Before the fix, full refresh recursively scanned the workspace and indexed the non-discovered file too.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml refresh_workspace_index_in_chunks_uses_ready_discovery_files` and saw `NotDiscovered.ets` appear in `added_paths`.

- [x] **Step 3: Prefer ready discovery files in full refresh**

Added `load_ready_discovered_files` and changed chunked full refresh to build its snapshot from the ready discovery catalog when available, falling back to recursive `scan_workspace` only when discovery is not ready.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml refresh_workspace_index_in_chunks_uses_ready_discovery_files
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_full_refresh_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_store_service_tests
wc -l src-tauri/src/services/workspace_index_full_refresh_service.rs src-tauri/src/services/workspace_index_full_refresh_service_tests.rs src-tauri/src/services/workspace_discovery_store_service.rs src-tauri/src/services/workspace_discovery_store_service_tests.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 9: Discovery Visible Status

**Files:**

- Modify: `src-tauri/src/services/workspace_index_task_status_service.rs`
- Modify: `src-tauri/src/services/workspace_index_state_machine_service_tests.rs`
- Modify: `src/components/layout/app-shell-model.ts`
- Modify: `tests/frontend/app-shell-model.test.ts`
- Modify: `docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md`

- [x] **Step 1: Write failing visible-status tests**

Covered running discovery task publication as `kind = "discovery"` and status bar text rendering as `Index: Discovering files` / `Index: Discovering files (1,024+)`.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml discovery_task_running_status_uses_discovery_kind` and saw `changed-paths` instead of `discovery`. Ran `pnpm test tests/frontend/app-shell-model.test.ts` and saw `Index: running discovery (0/1)`.

- [x] **Step 3: Implement discovery-specific status projection**

Mapped `workspace-discovery` changed-path tasks to `discovery` for queued/running statuses, kept task id aligned with the visible kind, and formatted discovery status separately in the shell model.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_state_machine_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery
pnpm test tests/frontend/app-shell-model.test.ts
wc -l src-tauri/src/services/workspace_index_task_status_service.rs src-tauri/src/services/workspace_index_state_machine_service_tests.rs src/components/layout/app-shell-model.ts tests/frontend/app-shell-model.test.ts docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 10: Discovery Diagnostics And Health Facts

**Files:**

- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service.rs`
- Modify: `src-tauri/src/services/workspace_index_diagnostics_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_health_service.rs`
- Modify: `src-tauri/src/services/workspace_index_health_service_tests.rs`
- Modify: `src/features/workspace/workspace-index-api-types.ts`
- Modify: `src/features/workspace/workspace-index-management-api.ts`
- Modify: frontend diagnostics/API tests.

- [x] **Step 1: Write failing diagnostics and health tests**

Covered `workspace_discovery_state` facts appearing in diagnostics and health: status, discovered file count, excluded count, and whether the cursor still has more work.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml discovery` and saw missing `discovery_status`, `discovered_file_count`, `discovery_excluded_count`, and `discovery_has_more` model fields.

- [x] **Step 3: Implement discovery facts**

Added discovery fields to backend diagnostics/health models, loaded them from `workspace_discovery_state`, and mirrored the contract in frontend index API types and fallback responses.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml discovery
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_diagnostics_service_tests
pnpm test tests/frontend/workspace-api.test.ts tests/frontend/use-index-diagnostics-controller.test.tsx tests/frontend/index-diagnostics-center.test.tsx
wc -l src-tauri/src/models/workspace.rs src-tauri/src/services/workspace_index_diagnostics_service.rs src-tauri/src/services/workspace_index_health_service.rs src/features/workspace/workspace-index-api-types.ts src/features/workspace/workspace-index-management-api.ts
git diff --check
```

## Task 11: Discovery Facts In Diagnostics UI

**Files:**

- Modify: `src/components/layout/IndexDiagnosticsCenter.tsx`
- Modify: `tests/frontend/index-diagnostics-center.test.tsx`
- Modify: `docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md`

- [x] **Step 1: Write failing UI test**

Covered `Discovery`, `Discovered files`, `Excluded entries`, and `Discovery cursor` appearing in the Health / Storage section when diagnostics include discovery facts.

- [x] **Step 2: Verify red**

Ran `pnpm test tests/frontend/index-diagnostics-center.test.tsx` and saw the Health / Storage section lacked a `Discovery` metric.

- [x] **Step 3: Render discovery metrics**

Added discovery status, discovered file count, excluded entry count, and cursor-more state to the diagnostics metric grid.

- [x] **Step 4: Verify**

Run:

```bash
pnpm test tests/frontend/index-diagnostics-center.test.tsx
pnpm test tests/frontend/workspace-api.test.ts tests/frontend/use-index-diagnostics-controller.test.tsx tests/frontend/index-diagnostics-center.test.tsx
wc -l src/components/layout/IndexDiagnosticsCenter.tsx tests/frontend/index-diagnostics-center.test.tsx docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 12: Delay Background Refresh Until Discovery Ready

**Files:**

- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_follow_up_task_service.rs`
- Modify: `src-tauri/src/services/workspace_index_follow_up_task_service_tests.rs`
- Modify: `docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md`

- [x] **Step 1: Write failing sequencing test**

Changed manager open tests to assert `background-refresh-after-open` is not run in the discovery batch and is only scheduled after discovery reaches `ready`.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests` and saw `background-refresh-after-open` still present in the discovery batch.

- [x] **Step 3: Move refresh scheduling behind discovery ready**

Removed eager background refresh scheduling from `open_workspace_index`; added follow-up scheduling that creates `background-refresh-after-open` only from a successful `discovery` `ready` result.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_follow_up_task_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_continuation_service_tests
wc -l src-tauri/src/services/workspace_index_manager_service.rs src-tauri/src/services/workspace_index_manager_service_tests.rs src-tauri/src/services/workspace_index_follow_up_task_service.rs src-tauri/src/services/workspace_index_follow_up_task_service_tests.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 5: Discovery Follow-Up Scheduling

**Files:**

- Create: `src-tauri/src/services/workspace_index_follow_up_task_service.rs`
- Create: `src-tauri/src/services/workspace_index_follow_up_task_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_discovery_task_service.rs`
- Modify: `src-tauri/src/services/workspace_discovery_task_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing follow-up tests**

Covered scheduling a discovery task after an `open-workspace` result and manager-level execution order where discovery runs before `background-refresh-after-open`.

- [x] **Step 2: Verify red**

Ran follow-up tests before implementation and saw missing module / ordering failures.

- [x] **Step 3: Implement follow-up scheduler**

Added `schedule_index_follow_up_tasks`, preserving existing refresh continuation behavior while adding discovery follow-up scheduling after open results.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_follow_up_task_service_tests
cargo test --manifest-path src-tauri/Cargo.toml open_workspace_schedules_discovery_follow_up_task
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_task_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests
wc -l src-tauri/src/services/workspace_index_follow_up_task_service.rs src-tauri/src/services/workspace_index_follow_up_task_service_tests.rs src-tauri/src/services/workspace_index_manager_service.rs src-tauri/src/services/workspace_index_manager_service_tests.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 4: Discovery Task Boundary

**Files:**

- Create: `src-tauri/src/services/workspace_discovery_task_service.rs`
- Create: `src-tauri/src/services/workspace_discovery_task_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing task-boundary tests**

Covered stable discovery reason, reason identification, scheduler task construction, priority, and user-visible kind label.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_task_service_tests` before implementation and saw a missing module failure.

- [x] **Step 3: Implement task-boundary service**

Added `discovery_task_reason`, `is_workspace_discovery_task_reason`, `discovery_task_kind_label`, and `workspace_discovery_task`.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_task_service_tests
wc -l src-tauri/src/services/workspace_discovery_task_service.rs src-tauri/src/services/workspace_discovery_task_service_tests.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```

## Task 3: Discovery Chunk Runner

**Files:**

- Create: `src-tauri/src/services/workspace_discovery_runner_service.rs`
- Create: `src-tauri/src/services/workspace_discovery_runner_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_discovery_store_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing runner tests**

Covered a first chunk persisting discovered files with `running` state, and a resumed chunk marking state `ready` with cumulative discovered count.

- [x] **Step 2: Verify red**

Ran `cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_runner_service_tests` before implementation and saw a missing module failure.

- [x] **Step 3: Implement runner**

Added `run_workspace_discovery_chunk(root, cursor, limit, generation)` to call chunk discovery, persist the file chunk, count accumulated files, and upsert discovery state.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_runner_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_store_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_service_tests
wc -l src-tauri/src/services/workspace_discovery_runner_service.rs src-tauri/src/services/workspace_discovery_runner_service_tests.rs src-tauri/src/services/workspace_discovery_store_service.rs src-tauri/src/services/workspace_discovery_store_service_tests.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-workspace-discovery-stage.md
git diff --check
```
