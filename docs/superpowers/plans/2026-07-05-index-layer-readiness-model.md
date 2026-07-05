# Index Layer Readiness Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first backend contract for layered index readiness so large-project search, navigation, completion, and diagnostics can reason about each index layer independently.

**Architecture:** Keep existing SQLite index tables as the source of truth. Add focused model and service files that summarize Discovery, File Catalog, Fingerprint, Content, Stub, Symbol, Reference, Dependency Graph, and SDK readiness without changing UI or query behavior in this slice.

**Tech Stack:** Rust/Tauri backend, SQLite via `rusqlite`, existing workspace index schema and fixture helpers, Cargo tests.

---

## Task 1: Backend Layer Readiness Contract

**Files:**

- Create: `src-tauri/src/models/workspace_index_layer.rs`
- Create: `src-tauri/src/services/workspace_index_layer_readiness_service.rs`
- Create: `src-tauri/src/services/workspace_index_layer_readiness_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing service tests**

Cover:

- empty workspace reports missing Discovery/FileCatalog layers;
- indexed current file reports ready FileCatalog/Content/Stub/Symbol readiness;
- discovery partial state reports a partial Discovery layer;
- SDK missing is explicit and does not hide other ready layers.

- [x] **Step 2: Verify red**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_readiness_service_tests
```

Expected before implementation: compile failure because the model/service modules do not exist.

- [x] **Step 3: Implement the model and service**

Expose:

```rust
pub fn get_workspace_index_layer_readiness(
    root_path: &str,
    current_file_path: Option<&str>,
) -> Result<WorkspaceIndexLayerReadinessReport, String>
```

Use existing SQLite facts only. Do not add new schema in this slice.

- [x] **Step 4: Verify**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_readiness_service_tests
wc -l src-tauri/src/models/workspace_index_layer.rs src-tauri/src/services/workspace_index_layer_readiness_service.rs src-tauri/src/services/workspace_index_layer_readiness_service_tests.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-index-layer-readiness-model.md
git diff --check
```

## Follow-Up Slices

1. Add a Tauri command and frontend API type for the layer report.
2. Render the layer report in the Index Diagnostics Center.
3. Let Query Explain link misses to specific missing/stale layers.
4. Add large-project partial-search gates that consume this report.
