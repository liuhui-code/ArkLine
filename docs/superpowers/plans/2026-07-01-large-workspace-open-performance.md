# Large Workspace Open Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArkLine open large and ultra-large projects immediately, while discovery, indexing, search, definition, usages, and completion become progressively available through observable background stages.

**Architecture:** Split workspace opening into three independent paths: instant shell open, background discovery, and background indexing. SQLite remains the durable index store; memory holds only hot queues, active generations, and visible-file state. The UI must render from a shallow workspace snapshot and request directory/file/index data lazily.

**Tech Stack:** Rust/Tauri backend, SQLite, existing workspace index manager and worker services, React workspace shell, Vitest frontend tests, Rust service tests.

---

## Industry Baseline

JetBrains reduces project analysis time with shared indexes generated once and reused locally or across machines. Its documentation also treats large projects as a scope-management problem: unloaded modules are ignored by search, refactoring, and compilation until the user loads them again. VS Code keeps the shell responsive by relying on workspace settings, glob excludes, gitignore-aware search, and lazily navigated file/search surfaces instead of forcing a full project scan before the UI can render.

References:

- JetBrains Shared Indexes: `https://www.jetbrains.com/help/idea/shared-indexes.html`
- JetBrains Unload Modules: `https://www.jetbrains.com/help/idea/unloading-modules.html`
- VS Code Search and exclude behavior: `https://code.visualstudio.com/docs/editing/codebasics`
- VS Code Workspace settings and `files.exclude` / `search.exclude`: `https://code.visualstudio.com/docs/configure/settings`

## Current Problem

ArkLine has already moved full indexing out of the synchronous open command, but `open_workspace` still calls `scan_workspace_for_open`, which recursively scans up to 1,000 files. On an ultra-large project, that still creates a visible loading spinner before the workbench can become usable. The correct mature-IDE model is stricter:

- Open validates the root and returns a shell snapshot.
- The project tree loads one directory level at a time.
- Discovery enumerates the full workspace in small background batches.
- Index phases consume discovered file batches by priority.
- Query surfaces expose partial readiness instead of blocking.

## Design

### 1. Instant Open Contract

`open_workspace` must not recursively walk the project. It should:

- validate that the root path exists and is a directory;
- return `WorkspaceSnapshot` with root metadata, a shallow root file list or an empty file list, and `scanSummary.truncated = true`;
- schedule background discovery/indexing through `WorkspaceIndexManagerRuntime`;
- start the worker and emit task status updates;
- let the frontend call `list_workspace_directory(root, root)` immediately for the visible tree.

This makes open time proportional to root validation plus one shallow directory read, not project size.

### 2. Discovery Before Indexing

Add a discovery stage that owns project enumeration. It should produce durable file facts before expensive symbol/reference/content work:

- `workspace_discovered_files`: path, kind, size, modified time, content hash if cheap, excluded flag, discovery generation.
- `workspace_discovery_state`: root, generation, cursor, status, discovered count, excluded count, truncated/deferred count, last error.
- chunk size target: 250-1,000 files per worker tick.

The first implementation can use existing in-memory task continuation if durable cursors are too much for one slice, but the service boundary must be named as discovery, not hidden inside full indexing.

### 3. Index Phase Pipeline

Indexing should consume discovered files through separate priority lanes:

- visible files: first screen, selected/open files, completion context;
- changed files: watcher/editor saves;
- foreground navigation/completion: caret-driven definition/completion requests;
- background content index: global text search;
- background symbols/references: Double Shift, usages, definition;
- SDK indexing: separate queue, never blocks project open.

Each phase must publish readiness independently. A query can be available for visible/open files before the full project is indexed.

### 4. Scope Control

Large-project stability needs user-visible scope control, not only faster code:

- default excludes: `.git`, `.hvigor`, `.idea`, `.arkline`, `.ohpm`, `build`, `coverage`, `dist`, `oh_modules`, `out`, `node_modules`;
- project excludes from `.gitignore`;
- future workspace excludes from `.arkline/settings.json`;
- module unload/load model for Harmony modules and generated directories;
- health warnings when a directory dominates file count.

### 5. Cache And Reuse

Reopen should prefer stale-but-useful cached facts:

- load cached discovered files and index readiness immediately;
- mark them stale if file fingerprints are unknown or out of date;
- repair stale areas in the background;
- add a future prebuilt SDK/project index import path, mirroring JetBrains shared-index ideas.

### 6. UI Behavior

The workbench should stop implying “project not opened” while background work runs:

- after open, show the root tree immediately;
- status bar shows `Opened`, `Discovering`, `Indexing`, `Partial`, or `Ready`;
- global search, Double Shift, completion, and definition show partial-readiness messages;
- no modal/spinner blocks normal editor/project-tree interaction;
- root directory loading failures are surfaced in the project tree/status bar, not as a stuck global spinner.

## Acceptance Gates

- Opening a fixture with 100,000 generated files returns before recursive scan/index starts.
- `open_workspace` does not call recursive file collection.
- The root project tree loads through `list_workspace_directory`.
- Background task statuses show queued/running/partial/ready without blocking the shell.
- Visible-file indexing remains prioritized over background full refresh.
- Global search and Double Shift return partial/cached results with readiness metadata while indexing continues.
- Tests protect the no-recursive-open invariant.

---

## Executable Plan

### Task 1: Make open snapshot root-only

**Files:**

- Modify: `src-tauri/src/services/workspace_service.rs`
- Modify: `src-tauri/src/commands/workspace_tests.rs`
- Test: `src-tauri/src/services/workspace_service.rs`

- [x] **Step 1: Add a failing root-only open scan test**

Add or replace the current open-scan large workspace test with a test that creates many nested files and asserts that `scan_workspace_for_open` does not return recursively discovered files.

Expected assertion shape:

```rust
let snapshot = scan_workspace_for_open(&root).unwrap();

assert_eq!(snapshot.root_path, normalize_path(&root));
assert!(snapshot.files.is_empty());
assert_eq!(snapshot.scan_summary.scanned_files, 0);
assert!(snapshot.scan_summary.truncated);
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_service::tests::open_scan_returns_root_only_partial_snapshot_for_large_workspaces
```

Expected: fail because current code returns up to 1,000 recursively scanned files.

- [x] **Step 3: Replace recursive open scan with root-only snapshot**

Change `scan_workspace_for_open` so it validates the root and returns root metadata without calling `collect_files`.

Implementation shape:

```rust
pub fn scan_workspace_for_open(root_path: &Path) -> Result<WorkspaceSnapshot, String> {
    validate_workspace_root(root_path)?;
    Ok(WorkspaceSnapshot {
        root_name: workspace_root_name(root_path),
        root_path: normalize_path(root_path),
        files: Vec::new(),
        scan_summary: WorkspaceScanSummary {
            scanned_files: 0,
            skipped_entries: 0,
            truncated: true,
            exclude_rules: default_exclude_rules(),
        },
    })
}
```

Also extract tiny helpers so `workspace_service.rs` stays focused:

```rust
fn validate_workspace_root(root_path: &Path) -> Result<(), String> { ... }
fn workspace_root_name(root_path: &Path) -> String { ... }
fn default_exclude_rules() -> Vec<String> { ... }
```

- [x] **Step 4: Update command test expectations**

Change `open_workspace_command_returns_snapshot_and_queues_background_index` so it asserts the shell snapshot is partial and file-list independent:

```rust
assert_eq!(snapshot.root_path, root_path);
assert!(snapshot.files.is_empty());
assert!(snapshot.scan_summary.truncated);
```

Keep the assertion that an `open-workspace` task was queued/running/ready/partial.

- [x] **Step 5: Verify backend open behavior**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_service::tests workspace_tests
```

Expected: all tests pass.

### Task 2: Load root project tree for partial snapshots

**Files:**

- Modify: `src/components/layout/AppShell.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Add a failing frontend test**

Add a test that opens a workspace snapshot with `visibleFiles: []` and `scanSummary.truncated = true`, then asserts `listWorkspaceDirectory(root, root)` is called.

Mock snapshot shape:

```ts
{
  rootName: "HugeProject",
  rootPath: "/tmp/HugeProject",
  files: [],
  scanSummary: {
    scannedFiles: 0,
    skippedEntries: 0,
    truncated: true,
    excludeRules: ["node_modules"],
  },
}
```

- [x] **Step 2: Run the failing frontend test**

Run:

```bash
pnpm test -- --run tests/frontend/app-shell.test.tsx
```

Expected: fail because `applyWorkspaceSnapshot` only loads the lazy tree when `visibleFiles.length >= 1000`.

- [x] **Step 3: Load root directory whenever snapshot is partial**

Change the condition in `applyWorkspaceSnapshot`:

```ts
if (snapshot.scanSummary.truncated || snapshot.visibleFiles.length >= LAZY_PROJECT_TREE_FILE_THRESHOLD) {
  void loadProjectDirectory(snapshot.rootPath, snapshot.rootPath);
}
```

Keep `scheduleVisibleFilesIndex` unchanged; it already skips empty file lists.

- [x] **Step 4: Verify frontend behavior**

Run:

```bash
pnpm test -- --run tests/frontend/app-shell.test.tsx
```

Expected: pass.

### Task 3: Add discovery stage boundary

**Files:** create `src-tauri/src/services/workspace_discovery_service.rs`, create `src-tauri/src/services/workspace_discovery_service_tests.rs`, modify `src-tauri/src/lib.rs`, modify `src-tauri/src/services/workspace_index_manager_service.rs`.

- [ ] **Step 1: Add discovery service tests**

Cover:

- default excludes are honored;
- scanning returns a bounded chunk and a continuation flag;
- root validation errors are explicit;
- generated/dependency directories increment excluded counts.

Test API shape:

```rust
let result = discover_workspace_chunk(&root, None, 500).unwrap();
assert!(result.files.len() <= 500);
assert!(result.has_more);
assert!(result.excluded_count >= 1);
```

- [ ] **Step 2: Implement chunked discovery model**

Create focused structs:

```rust
pub struct WorkspaceDiscoveryCursor { pub pending_directories: Vec<String> }
pub struct WorkspaceDiscoveryChunk {
    pub files: Vec<String>,
    pub cursor: Option<WorkspaceDiscoveryCursor>,
    pub excluded_count: usize,
    pub has_more: bool,
}
```

Use breadth-first directory traversal with a max file count per call. Do not compute hashes in this slice.

- [ ] **Step 3: Register the module**

Add the new service/test modules in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Wire manager follow-up task planning**

The first manager integration should schedule discovery chunks before full refresh chunks. The output can still feed the existing changed-path/full-refresh indexing path, but the naming and task reason must identify discovery.

- [ ] **Step 5: Verify discovery**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_service_tests workspace_index_manager_service_tests
```

Expected: pass.

### Task 4: Persist discovery state

**Files:** create `src-tauri/src/services/workspace_discovery_schema_service.rs`, create `src-tauri/src/services/workspace_discovery_store_service.rs`, create `src-tauri/src/services/workspace_discovery_store_service_tests.rs`, modify `src-tauri/src/services/workspace_index_schema_service.rs`.

- [ ] **Step 1: Add schema tests**

Assert these tables exist after migration:

```sql
workspace_discovered_files
workspace_discovery_state
```

- [ ] **Step 2: Implement schema**

Create:

```sql
CREATE TABLE IF NOT EXISTS workspace_discovered_files (
  root_path TEXT NOT NULL, path TEXT NOT NULL, generation INTEGER NOT NULL,
  modified_ms INTEGER, size_bytes INTEGER, excluded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (root_path, path)
);
CREATE TABLE IF NOT EXISTS workspace_discovery_state (
  root_path TEXT PRIMARY KEY, generation INTEGER NOT NULL, status TEXT NOT NULL,
  discovered_count INTEGER NOT NULL, excluded_count INTEGER NOT NULL,
  cursor_json TEXT, updated_at_ms INTEGER NOT NULL, error TEXT
);
```

- [ ] **Step 3: Implement store functions**

Expose:

```rust
pub fn replace_discovered_file_chunk(root_path: &str, generation: i64, files: &[WorkspaceDiscoveredFile]) -> Result<(), String>
pub fn update_discovery_state(state: &WorkspaceDiscoveryState) -> Result<(), String>
pub fn load_discovered_files(root_path: &str, limit: usize) -> Result<Vec<String>, String>
```

- [ ] **Step 4: Verify persistence**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_discovery_store_service_tests workspace_index_schema_service_tests
```

Expected: pass.

### Task 5: Surface large-project readiness in UI

**Files:** modify `src/features/workspace/workspace-index-store.ts`, `src/components/layout/AppShell.tsx`, `tests/frontend/workspace-index-store.test.ts`, and `tests/frontend/app-shell.test.tsx`.

- [ ] **Step 1: Add readiness copy tests**

Expected UI copy:

```ts
"Workspace: opened"
"Discovery: running"
"Index: partial"
```

Avoid saying “ready” when only the root shell is opened.

- [ ] **Step 2: Update scan/status text**

When `scanSummary.truncated && scannedFiles === 0`, show opened/discovering language instead of “partial 0 files”.

- [ ] **Step 3: Connect task statuses to status bar**

Use `workspace-index-task-updated` statuses to distinguish discovery/indexing/SDK. If no discovery-specific status exists yet, map `open-workspace` running to `Discovering`.

- [ ] **Step 4: Verify UI readiness**

Run:

```bash
pnpm test -- --run tests/frontend/workspace-index-store.test.ts tests/frontend/app-shell.test.tsx
```

Expected: pass.

### Task 6: Add large-project regression gate

**Files:** create `src-tauri/src/services/workspace_large_open_performance_tests.rs`, modify `src-tauri/src/lib.rs`.

- [ ] **Step 1: Add no-recursive-open regression test**

Create nested directories with more than 10,000 files and assert:

- `scan_workspace_for_open` returns zero files;
- root directory listing returns only the root-level entries;
- no full scan is needed for the shell snapshot.

- [ ] **Step 2: Add background queue regression test**

Open a large workspace through `open_workspace_through_manager` and assert:

- snapshot returns partial root-only metadata;
- task statuses include `open-workspace`;
- no synchronous index state is required before return.

- [ ] **Step 3: Verify regression gate**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_open_performance_tests workspace_tests
```

Expected: pass.

### Task 7: Final verification

**Files:** no new files.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_service::tests workspace_tests workspace_index_manager_service_tests workspace_index_worker_service_tests
```

Expected: pass.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
pnpm test -- --run tests/frontend/workspace-index-store.test.ts tests/frontend/app-shell.test.tsx
```

Expected: pass.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: pass.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

## Follow-Up Roadmap

- Prebuilt SDK index bundles.
- Team/project shared indexes.
- Module unload/load UI.
- Workspace exclude settings UI.
- Discovery health panel with largest directories and repair actions.
- Query facades that return cached partial results while specific domains are still indexing.

## Self-Review

- The plan removes recursive work from the open path.
- The project tree remains usable through lazy directory loading.
- Discovery and indexing are separated as long-term architecture boundaries.
- The plan keeps durable facts in SQLite and transient state in memory.
- The first implementation slice is small enough to verify without redesigning the entire indexer.
