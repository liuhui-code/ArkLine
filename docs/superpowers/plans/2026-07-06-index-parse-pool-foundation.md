# Index Parse Pool Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first IDE-grade execution boundary for indexing by introducing a bounded parse pool that can run CPU parsing independently from the existing serial index worker.

**Architecture:** The existing index manager remains the scheduler and the existing SQLite paths remain the writer. This phase adds a focused parse-pool service that accepts prioritized parse jobs, executes them concurrently, preserves per-job errors, and returns parsed deltas for later writer integration.

**Tech Stack:** Rust std threads, `mpsc`, existing ArkTS stub parser, existing workspace index priority model, Cargo tests.

---

### Task 1: Parse Pool Service

**Files:**
- Create: `src-tauri/src/services/workspace_index_parse_pool_service.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/services/workspace_index_parse_pool_service_tests.rs`

- [ ] **Step 1: Write failing tests**

Add tests that prove:
- two background parse jobs can run concurrently when the pool has two workers
- a foreground job runs before a background job when a single worker is available
- one parse failure does not drop successful results from the same batch

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd src-tauri
cargo test workspace_index_parse_pool_service_tests
```

Expected: compilation fails because `workspace_index_parse_pool_service` does not exist yet.

- [ ] **Step 3: Implement minimal service**

Create:
- `WorkspaceIndexParseJob`
- `WorkspaceIndexParsedFile`
- `WorkspaceIndexParseResult`
- `WorkspaceIndexParsePool`

The pool sorts queued jobs by priority and generation, runs at most `max_workers`, and collects exactly one result per submitted job.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd src-tauri
cargo test workspace_index_parse_pool_service_tests
```

Expected: all parse-pool tests pass.

### Task 2: Integration Boundary

**Files:**
- Modify: `src-tauri/src/services/workspace_index_parse_pool_service.rs`
- Test: `src-tauri/src/services/workspace_index_parse_pool_service_tests.rs`

- [ ] **Step 1: Add ArkTS file parser constructor**

Expose `WorkspaceIndexParsePool::arkts_stub_pool(max_workers)` so existing index layers can later submit real file paths without knowing parser internals.

- [ ] **Step 2: Add real-file test**

Create a temporary `.ets` file, parse it through `arkts_stub_pool`, and assert the returned stub contains the expected declaration.

- [ ] **Step 3: Verify**

Run:

```bash
cd src-tauri
cargo test workspace_index_parse_pool_service_tests
```

Expected: all parse-pool tests pass.

### Task 3: Safety Gates

**Files:**
- Check: `src-tauri/src/services/workspace_index_parse_pool_service.rs`
- Check: `src-tauri/src/services/workspace_index_parse_pool_service_tests.rs`

- [ ] **Step 1: Check file length**

Run:

```bash
wc -l src-tauri/src/services/workspace_index_parse_pool_service.rs src-tauri/src/services/workspace_index_parse_pool_service_tests.rs
```

Expected: each file is under 500 lines.

- [ ] **Step 2: Run focused verification**

Run:

```bash
cd src-tauri
cargo test workspace_index_parse_pool_service_tests
```

Expected: all tests pass.

- [ ] **Step 3: Run existing worker priority tests**

Run:

```bash
cd src-tauri
cargo test workspace_index_manager_priority_tests
```

Expected: existing scheduler priority behavior still passes.

### Follow-Up After This Plan

The next phase should connect the parse pool to `workspace_stub_index_service` by splitting parsing from SQLite writes:

- parse workers produce `WorkspaceIndexParsedFile`
- writer code consumes parsed files and writes stubs/imports/exports/errors in one transaction
- foreground changed-path tasks use a small high-priority batch
- background full refresh uses bounded chunks and yields between chunks
