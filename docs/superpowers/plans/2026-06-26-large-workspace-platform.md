# Large Workspace Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArkLine open and operate on large HarmonyOS/ArkTS projects without blocking the UI, while creating a maintainable workspace foundation for Project Tree, Quick Open, Search, completion, and navigation.

**Architecture:** Split workspace handling into Workspace Core, Workspace Index, and feature consumers. Project opening must create a usable session quickly; directory loading, file scanning, and semantic indexing run separately and expose progress/status instead of blocking the shell.

**Tech Stack:** Tauri v2 commands in Rust, React + TypeScript state in the shell, Vitest for frontend tests, Cargo unit tests for workspace scanning and directory APIs.

---

### Task 1: Large Workspace Safety Baseline

**Files:**
- Modify: `src-tauri/src/services/workspace_service.rs`
- Modify: `src/features/workspace/workspace-store.ts`
- Test: `tests/frontend/workspace-store.test.ts`

- [x] **Step 1: Write failing tests for generated/dependency directory exclusion**

Add paths under `.idea`, `.ohpm`, `oh_modules`, `dist`, `out`, and `coverage` to `tests/frontend/workspace-store.test.ts` and expect them to be absent from `visibleFiles`.

- [x] **Step 2: Write failing Rust tests for native workspace scanning**

Extend `scans_workspace_and_ignores_default_excludes` in `src-tauri/src/services/workspace_service.rs` with the same generated/dependency directories.

- [x] **Step 3: Write failing Rust test for scan hard limit**

Add `scan_workspace_caps_large_file_sets`, create more than 20,000 files, and expect the returned file list to stop at 20,000.

- [x] **Step 4: Implement expanded excludes and scan cap**

Update both frontend and Rust exclude lists with HarmonyOS/IDE/build-output directories, and stop recursive collection once `MAX_WORKSPACE_FILES` is reached.

- [x] **Step 5: Verify the safety baseline**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/workspace-store.test.ts --reporter=dot
cargo test --manifest-path src-tauri/Cargo.toml workspace_service -- --nocapture
pnpm build
```

Expected: all commands pass.

### Task 2: Workspace Core Directory Listing API

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Test: Rust unit tests in `workspace_service.rs`

- [x] **Step 1: Add directory entry model**

Add `WorkspaceDirectoryEntry` with `name`, `path`, `kind`, `excluded`, and `hasChildren`.

- [x] **Step 2: Add `list_workspace_directory` service function**

Return only one directory level, sort directories before files, apply the same exclude rules, and avoid recursively walking descendants.

- [x] **Step 3: Expose Tauri command**

Add `list_workspace_directory(rootPath, directoryPath)` and register it in `src-tauri/src/lib.rs`.

- [x] **Step 4: Add frontend API wrapper**

Add `WorkspaceDirectoryEntry` and `listWorkspaceDirectory` to `WorkspaceApi`.

- [x] **Step 5: Verify**

Run Rust workspace tests and `pnpm build`.

### Task 3: Project Tree Lazy Loading

**Files:**
- Modify: `src/components/layout/ProjectToolWindow.tsx`
- Modify: `src/components/layout/ShellSidebar.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/project-tool-window.test.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Replace full-tree prop with directory-backed state**

Project Tree now supports root metadata plus a map of loaded directory children. The existing full-tree path is retained for small workspaces, while large workspaces switch to lazy directory-backed rendering.

- [x] **Step 2: Load root children after opening workspace**

When a large workspace opens, call `listWorkspaceDirectory(rootPath, rootPath)` and render only that level.

- [x] **Step 3: Load children on expansion**

When the user expands an unloaded directory, show a loading row, call `listWorkspaceDirectory`, then render returned children.

- [x] **Step 4: Preserve existing toolbar behaviors**

Keep New File, New Directory, Expand All, Collapse All, and Focus Active File. `Expand All` should expand loaded nodes only until a later background index exists.

- [x] **Step 5: Verify**

Run Project Tree and AppShell tests plus `pnpm build`.

### Task 4: Workspace Scan Status and Partial Index

**Files:**
- Modify: `src-tauri/src/services/workspace_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/ShellStatusBar.tsx`

- [x] **Step 1: Add scan summary fields**

Expose scanned count, skipped count, truncated flag, and active exclude rules.

- [x] **Step 2: Show status bar state**

Show `Workspace: scanning`, `Workspace: partial`, or `Workspace: ready`.

- [x] **Step 3: Gate Quick Open/Search wording**

Quick Open and Search should indicate partial results until the background index is ready.

- [x] **Step 4: Verify**

Run focused AppShell tests and `pnpm build`.

### Task 5: Index Platform Milestone 1

**Files:**
- Create: `src/features/workspace/workspace-index-store.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/ShellStatusBar.tsx`
- Modify: `src/features/search/workspace-text-search.ts`
- Test: `tests/frontend/workspace-index-store.test.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Introduce an index platform contract**

Add `WorkspaceIndexState`, `SearchCandidate`, index status, indexed paths, partial reason, and queryable file candidates. This is the frontend-facing contract that can later move behind a Rust/Tauri Index Host.

- [x] **Step 2: Route Quick Open through the index**

Quick Open now queries `workspace-index-store` instead of directly ranking `workspace.visibleFiles`. File candidates carry source, kind, score, and freshness.

- [x] **Step 3: Route Search through indexed search paths**

Workspace text search now reads paths from the index store, keeping Search Everywhere / Find in Files behind the same indexed source boundary.

- [x] **Step 4: Show index status in the IDE chrome**

Status bar shows `Index: empty`, `Index: ready`, or `Index: partial` with indexed file counts. Partial index notices are reused by Quick Open and Find in Files.

- [x] **Step 5: Verify**

Run search tests, AppShell tests, and `pnpm build`.

### Task 6: Rust Index Host Foundation

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Create: `src-tauri/src/services/workspace_index_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`

- [x] **Step 1: Add backend index state and candidate models**

Add Rust models aligned with the frontend index contract: index status, indexed file paths, partial reason, and search candidates.

- [x] **Step 2: Add in-memory Rust IndexHost runtime**

Index `WorkspaceSnapshot` data into a Tauri-managed runtime, keep per-workspace indexed paths, expose ready/partial state, and support Quick Open file candidate queries.

- [x] **Step 3: Register Tauri commands**

Index snapshots during `open_workspace`, and expose `get_workspace_index_state` plus `query_workspace_quick_open`.

- [x] **Step 4: Add frontend API wrappers**

Add optional `WorkspaceApi` methods for backend index state and Quick Open queries.

- [x] **Step 5: Verify**

Run Rust index/workspace tests, frontend index tests, and `pnpm build`.

### Task 7: Workspace Catalog Persistence

**Files:**
- Modify: `src-tauri/src/services/workspace_index_service.rs`
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_service.rs`
- Modify: `src/features/workspace/workspace-store.ts`
- Test: Rust unit tests in `workspace_index_service.rs` and `workspace_service.rs`
- Test: `tests/frontend/workspace-store.test.ts`

- [x] **Step 1: Add persistent catalog cache**

Persist indexed workspace catalog state to `.arkline/index/workspace-catalog.json` after indexing a workspace snapshot. This JSON adapter is the first stable persistence boundary before moving to SQLite.

- [x] **Step 2: Restore cache on backend index miss**

If a workspace is not present in memory, load the persisted catalog cache into `WorkspaceIndexRuntime` before answering index state or Quick Open queries.

- [x] **Step 3: Exclude ArkLine cache files from workspace scans**

Add `.arkline` to frontend and Rust exclude rules so persisted index files do not become project files.

- [x] **Step 4: Verify**

Run Rust index/workspace tests, frontend workspace store tests, and `pnpm build`.

### Task 8: Workspace Edit Index Incremental Updates

**Files:**
- Modify: `src-tauri/src/services/workspace_index_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/AppShell.tsx`

- [x] **Step 1: Add backend file delta updates**

Add `update_workspace_files` to Rust `WorkspaceIndexRuntime`, supporting added and removed file paths while preserving ready/partial index freshness.

- [x] **Step 2: Persist updated catalog state**

Write the updated catalog back to `.arkline/index/workspace-catalog.json` so new runtime instances restore the post-edit index.

- [x] **Step 3: Expose a Tauri command and frontend wrapper**

Add `update_workspace_index_files(rootPath, addedPaths, removedPaths)` and wire it through `WorkspaceApi`.

- [x] **Step 4: Sync index updates from workspace edits**

After create, delete, rename, text edit, directory delete, or directory rename plans apply, update the frontend index store and Rust IndexHost.

- [x] **Step 5: Verify**

Run Rust index tests, focused AppShell tests, and `pnpm build`.

### Task 9: Filesystem Refresh Foundation

**Files:**
- Modify: `src-tauri/src/services/workspace_index_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`

- [x] **Step 1: Add refresh API to IndexHost**

Add `refresh_workspace_index(rootPath)` in Rust to rescan the workspace using the canonical scanner and rebuild/persist the catalog.

- [x] **Step 2: Verify external filesystem changes are reflected**

Cover add/remove files outside the existing in-app workspace edit path, then refresh and verify Quick Open reflects the new catalog.

- [x] **Step 3: Expose Tauri and frontend API**

Register `refresh_workspace_index` and add `WorkspaceApi.refreshWorkspaceIndex`.

- [x] **Step 4: Verify**

Run Rust index tests and `pnpm build`.

### Task 10: Filesystem Change Detection Summary

**Files:**
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/services/workspace_index_service.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`

- [x] **Step 1: Add refresh result model**

Add `WorkspaceIndexRefreshResult` with refreshed state, changed flag, added paths, and removed paths.

- [x] **Step 2: Detect added and removed paths during refresh**

Compare previous indexed file paths against the latest filesystem scan so external file changes can be reported instead of only silently rebuilding the catalog.

- [x] **Step 3: Expose Tauri and frontend API**

Register `refresh_workspace_index_with_changes` and add `WorkspaceApi.refreshWorkspaceIndexWithChanges`.

- [x] **Step 4: Verify**

Run Rust index tests and `pnpm build`.

### Task 11: Polling Workspace Index Watcher

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Poll backend change detection**

When a workspace is open and the backend supports change summaries, poll `refreshWorkspaceIndexWithChanges` on a conservative interval.

- [x] **Step 2: Apply external changes to frontend state**

When a poll reports added or removed paths, update the frontend index store, workspace visible files, and project tree source.

- [x] **Step 3: Verify**

Run focused AppShell tests, Rust index tests, and `pnpm build`.

### Task 12: TextIndex Foundation

**Files:**
- Create: `src-tauri/src/services/workspace_text_search_service.rs`
- Modify: `src-tauri/src/models/workspace.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/features/documents/document-store.ts`
- Modify: `src/features/search/workspace-text-search.ts`

- [x] **Step 1: Add backend text search models**

Add request/result/match/context/query models aligned with the existing frontend `WorkspaceTextSearchResult` shape.

- [x] **Step 2: Add Rust text search service**

Search indexed workspace paths from the catalog, support text, regex literals, case sensitivity, whole-word matching, context lines, result limits, and platform path restoration for macOS/Linux paths that were normalized in the catalog.

- [x] **Step 3: Expose Tauri command and frontend wrapper**

Register `search_workspace_text` and add `WorkspaceApi.searchWorkspaceText`.

- [x] **Step 4: Wire Search Everywhere / Find in Files safely**

Use native backend search only inside the Tauri runtime and only when there are no dirty editor documents; keep the existing frontend path as the fallback for tests, browser previews, and unsaved editor content.

- [x] **Step 5: Verify**

Run Rust text search tests, focused AppShell search tests, and `pnpm build`.

### Task 13: Long-Term Incremental Indexing

**Files:**
- Modify after Task 12 stabilizes.

- [x] **Step 0: Add frontend watcher boundary and Tauri event wrapper**

Add optional `WorkspaceApi.watchWorkspaceIndex(rootPath, onChange)`, make AppShell prefer watcher events over frontend polling when the API is available, and wire the default workspace API to the `workspace-index-changed` Tauri event. Keep polling as the fallback until the Rust native watcher is implemented.

- [x] **Step 1: Replace polling with native watcher events**

Move from interval polling to platform file events through `notify`, while keeping `WorkspaceIndexRefreshResult` as the UI-facing change summary. AppShell now prefers `watchWorkspaceIndex`; polling remains only as a fallback for injected or unsupported APIs.

- [x] **Step 2: Add SQLite catalog adapter**

Persist the workspace catalog to `.arkline/index/workspace-catalog.sqlite` using a schema-versioned row that stores the current index state JSON. Restore now prefers SQLite and falls back to the legacy JSON cache, so existing workspaces remain compatible while future schema evolution can move fields into normalized tables.

- [x] **Step 3: Add SDK and semantic index state machines**

Keep file availability separate from semantic readiness. Added a frontend `SemanticCapabilityState` that combines semantic provider mode and SDK apply state into explicit capability flags for semantic navigation, semantic completion, and local fallback. The status bar now shows SDK capability separately from workspace index status.

- [x] **Step 4: Verify on large fixtures**

Added an ignored Rust verification harness for generated large workspaces and documented explicit 10k, 50k, and 200k commands in `docs/large-workspace-fixture-verification.md`. Ran the 10k fixture locally: scan ~160ms, index ~435ms, query ~132ms. Larger runs remain explicit because the current scanner intentionally caps normal workspace snapshots at 20,000 files and reports partial results.
