# Index Core Next Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the next maintainable slice of ArkLine's IDE-grade index core: scheduler observability, health/repair contracts, and large-project regression gates.

**Architecture:** Keep SQLite as the durable fact store. Keep scheduler/worker/readiness/health/query facade as separate services, with small Rust files under 500 lines. User-facing IDE features must consume readiness-aware backend contracts instead of inventing UI-only fallback behavior.

**Tech Stack:** Rust/Tauri backend, SQLite, existing workspace index services, React/Vitest frontend API tests, Cargo test suites.

---

## Active Objective

The active goal remains:

> Build ArkLine's index system into a durable IDE knowledge layer for Double Shift, global search, Ctrl+Click, Find Usages, completion, SDK APIs, and large-project indexing.

For the next implementation sessions, do not expand visual polish first. Finish the core pipeline in this order:

1. scheduler state and queue observability;
2. cancellation and intra-task yielding;
3. health and repair API;
4. large-project regression harness;
5. facade adoption cleanup for search, definition, usages, and completion.

## Non-Negotiable Guardrails

- Every new Rust service or test file must stay below 500 lines.
- Add failing backend tests before implementation.
- Keep durable index data in SQLite; keep memory for queue state, hot caches, active generations, and transient worker state.
- Do not add UI fallbacks that hide stale, partial, failed, or missing readiness.
- Commit only after a small, verified slice passes focused tests and `git diff --check`.

## Task 1: Finish Queue Pressure Metrics

**Goal:** Let health/reporting code explain whether index work is blocked by queued foreground/background work.

**Files:**

- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_scheduler_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_priority_tests.rs`
- Modify: `docs/superpowers/plans/2026-07-01-ide-grade-index-roadmap.md`

- [x] **Step 1: Fix the failing pressure test expectation**

In `workspace_index_manager_priority_tests.rs`, keep the existing test name `reports_queue_pressure_for_pending_index_tasks`, but ensure same-workspace pending count expects both refresh and visible-file tasks:

```rust
assert_eq!(pressure.pending_task_count, 3);
assert_eq!(pressure.workspace_pending_task_count, 2);
assert_eq!(pressure.highest_priority.as_deref(), Some("visibleFiles"));
assert_eq!(pressure.highest_priority_task_kind.as_deref(), Some("changed-paths"));
```

- [x] **Step 2: Add scheduler pending snapshot**

In `workspace_index_scheduler_service.rs`, add:

```rust
pub fn pending_tasks(&self) -> Vec<WorkspaceIndexTask> {
    self.tasks.iter().cloned().collect()
}
```

Also add a public priority label helper:

```rust
pub fn task_priority_label(priority: WorkspaceIndexTaskPriority) -> &'static str {
    match priority {
        WorkspaceIndexTaskPriority::Background => "background",
        WorkspaceIndexTaskPriority::SdkIndexing => "sdkIndexing",
        WorkspaceIndexTaskPriority::FullRefresh => "fullRefresh",
        WorkspaceIndexTaskPriority::ChangedFiles => "changedFiles",
        WorkspaceIndexTaskPriority::VisibleFiles => "visibleFiles",
        WorkspaceIndexTaskPriority::Normal => "normal",
        WorkspaceIndexTaskPriority::UserBlocking => "userBlocking",
        WorkspaceIndexTaskPriority::ForegroundCompletion => "foregroundCompletion",
        WorkspaceIndexTaskPriority::ForegroundNavigation => "foregroundNavigation",
    }
}
```

- [x] **Step 3: Add manager pressure query**

In `workspace_index_manager_service.rs`, expose:

```rust
pub fn get_queue_pressure(&self, root_path: &str) -> Result<WorkspaceIndexQueuePressure, String> {
    let tasks = self
        .scheduler
        .lock()
        .map_err(|_| "Workspace index scheduler lock poisoned".to_string())?
        .pending_tasks();
    let highest = tasks.iter().max_by(|left, right| {
        left.priority
            .cmp(&right.priority)
            .then_with(|| right.generation.cmp(&left.generation))
    });

    Ok(WorkspaceIndexQueuePressure {
        root_path: root_path.to_string(),
        pending_task_count: tasks.len(),
        workspace_pending_task_count: tasks
            .iter()
            .filter(|task| task.root_path == root_path)
            .count(),
        highest_priority: highest.map(|task| task_priority_label(task.priority).to_string()),
        highest_priority_task_kind: highest.map(|task| task_kind_label(&task.kind).to_string()),
    })
}
```

- [x] **Step 4: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_priority_tests::reports_queue_pressure_for_pending_index_tasks
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_priority_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_scheduler_service
git diff --check
```

Expected result: queue pressure can be read without mutating scheduler state.

## Task 2: Add Cancellation Token Contract

**Goal:** Make active long-running indexing interruptible when newer foreground work or a superseding refresh arrives.

**Files:**

- Create: `src-tauri/src/services/workspace_index_cancellation_service.rs`
- Create: `src-tauri/src/services/workspace_index_cancellation_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Add cancellation tests**

Create tests covering:

```rust
#[test]
fn cancellation_token_starts_active() {
    let token = WorkspaceIndexCancellationToken::new(7);
    assert_eq!(token.generation(), 7);
    assert!(!token.is_cancelled());
}

#[test]
fn cancellation_token_reports_cancelled_after_cancel() {
    let token = WorkspaceIndexCancellationToken::new(7);
    token.cancel();
    assert!(token.is_cancelled());
}
```

- [x] **Step 2: Implement token**

Use `Arc<AtomicBool>` so manager and worker can share cancellation state without holding locks while indexing:

```rust
#[derive(Clone)]
pub struct WorkspaceIndexCancellationToken {
    generation: u64,
    cancelled: Arc<AtomicBool>,
}
```

- [x] **Step 3: Wire manager superseding**

When scheduling a task that supersedes an active generation for the same root/task domain, call `cancel()` on the active token and publish `cancelling` or `superseded` through the existing state-machine adapter.

- [x] **Step 4: Wire worker checks**

Before each major scan/index/write phase, call `token.is_cancelled()`. If true, stop work and return the existing superseded/cancelled result path instead of publishing partial fresh readiness.

- [x] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_cancellation_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_worker_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_state_machine_service_tests
git diff --check
```

Expected result: superseded active work stops before writing stale or misleading readiness.

## Task 3: Add Intra-Task Chunking

**Goal:** Prevent a single huge workspace refresh from monopolizing the worker tick.

**Files:**

- Create: `src-tauri/src/services/workspace_index_chunk_service.rs`
- Create: `src-tauri/src/services/workspace_index_chunk_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Add chunk planner tests**

Cover deterministic chunking:

```rust
#[test]
fn chunks_paths_by_limit_without_dropping_order() {
    let chunks = chunk_paths(vec!["A.ets", "B.ets", "C.ets"], 2);
    assert_eq!(chunks, vec![vec!["A.ets", "B.ets"], vec!["C.ets"]]);
}
```

- [x] **Step 2: Implement chunk service**

Add pure functions only: chunk path lists, count chunks, and report current chunk progress. Keep filesystem scanning in existing services.

- [x] **Step 3: Wire refresh indexing**

For large refresh tasks, split file processing into chunks. After each chunk, update progress and let the worker return control if the current tick budget is exhausted.

Progress: changed-path indexing uses chunked sub-batches and checks cancellation between chunks. Full workspace refresh now uses a continuation model, marks yielded work as partial, and requeues remaining chunks through the manager. Persisting remaining chunks across app restarts is the next refinement.

- [x] **Step 4: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_chunk_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_worker_service_tests
git diff --check
```

Expected result: queued foreground tasks are not starved behind one giant refresh.

## Task 4: Add Health Service

**Goal:** Give users and developers a truthful answer for missing search, jump, usage, completion, or SDK results.

**Files:**

- Create: `src-tauri/src/services/workspace_index_health_service.rs`
- Create: `src-tauri/src/services/workspace_index_health_service_tests.rs`
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/workspace-api.test.ts`

- [x] **Step 1: Add health model tests**

Cover `healthy`, `partial`, `stale`, `failed`, and `missingSdk` states with queue pressure included.

- [x] **Step 2: Implement backend health contract**

Return structured facts:

```rust
WorkspaceIndexHealth {
    root_path,
    status,
    file_count,
    symbol_count,
    reference_count,
    sdk_api_count,
    unresolved_import_count,
    parser_failure_count,
    queue_pressure,
    repair_actions,
}
```

- [x] **Step 3: Add Tauri/API command**

Expose `get_workspace_index_health(rootPath)` and `WorkspaceApi.getWorkspaceIndexHealth(rootPath)`.

- [x] **Step 4: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_priority_tests
pnpm test -- --run tests/frontend/workspace-api.test.ts
git diff --check
```

Expected result: missing IDE behavior can be diagnosed from one backend contract.

## Task 5: Add Large-Project Regression Harness

**Goal:** Stop regressions where large projects load slowly, Double Shift misses files/classes/symbols, global text search misses content, or completion loses semantic candidates.

**Files:**

- Create: `src-tauri/src/services/workspace_large_fixture_service.rs`
- Create: `src-tauri/src/services/workspace_large_project_index_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `docs/superpowers/plans/2026-07-01-ide-grade-index-roadmap.md`

- [x] **Step 1: Generate deterministic fixture**

Create many ETS files with stable names, classes, functions, member calls, imports, SDK-like calls, and searchable text.

- [x] **Step 2: Add regression tests**

Cover:

```text
open workspace -> indexed file count is nonzero
Double Shift files -> finds generated file by prefix and fuzzy query
Double Shift classes -> finds generated class
Double Shift symbols -> finds function/member symbol
global text search -> finds known content line
definition -> resolves generated import/member target
usages -> returns indexed references
completion -> returns keyword, local, workspace, member, SDK, and snippet candidates
```

- [x] **Step 3: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests
pnpm test -- --run tests/frontend/app-shell.test.tsx tests/frontend/completion-candidate-provider.test.ts
git diff --check
```

Expected result: future index changes cannot silently break the core IDE workflows.

## Completion Criteria For This Plan

- Queue pressure is available to health/reporting code.
- Active index work can be cancelled or superseded without stale publication.
- Large single refresh tasks yield in bounded chunks.
- Health API explains missing, stale, failed, partial, and SDK-blocked states.
- A deterministic large-project fixture protects search, navigation, usages, and completion.
- All changed/new files stay under 500 lines.
