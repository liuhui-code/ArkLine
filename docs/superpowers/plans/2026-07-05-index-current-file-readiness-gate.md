# Index Current File Readiness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a regression gate proving large-workspace indexing keeps the active file usable for navigation while background discovery and deep indexing continue.

**Architecture:** Keep the durable SQLite index and existing scheduler. Add a focused backend regression test that opens a large fixture, schedules foreground navigation for the active file, runs one worker batch, and asserts current-file readiness without waiting for full-project deep indexing.

**Tech Stack:** Rust/Tauri backend, SQLite index store, existing workspace index manager/runtime services, Cargo tests.

---

## Current Context

The local index plans show that scheduler, discovery, query facade, repair actions, and query observability are mostly implemented. The remaining risk is not another broad architecture pass; it is preventing regressions where a large project opens but the active file cannot quickly serve definition/completion-related index facts.

This slice intentionally avoids UI work and avoids new readiness fields. It protects the backend contract first.

## Task 1: Large Workspace Active File Readiness Gate

**Files:**

- Modify: `src-tauri/src/services/workspace_large_project_index_tests.rs`

- [x] **Step 1: Write the failing regression test**

Add a test that:

- creates a large fixture;
- opens the workspace through `WorkspaceIndexManagerRuntime`;
- drains the open task;
- schedules `ForegroundNavigation` for the active file;
- drains one worker batch;
- asserts file/symbol readiness is available for that file.

- [x] **Step 2: Verify red**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml large_project_foreground_navigation_makes_active_file_ready_before_full_refresh
```

Expected before implementation: failure if foreground navigation is not independently schedulable or does not persist current-file index facts.

- [x] **Step 3: Implement minimal support only if needed**

If the test fails, keep changes narrow:

- use existing `schedule_changed_path_task`;
- use `WorkspaceIndexTaskPriority::ForegroundNavigation`;
- avoid full refresh or UI-side fallbacks.

- [x] **Step 4: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml large_project_foreground_navigation_makes_active_file_ready_before_full_refresh
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests
wc -l src-tauri/src/services/workspace_large_project_index_tests.rs docs/superpowers/plans/2026-07-05-index-current-file-readiness-gate.md
git diff --check
```

## Next Slices

1. Add discovery catalog evidence to current-file readiness.
2. Add partial Search Everywhere regression gates for discovered files and current-file symbols.
3. Add profiler-backed gates for deep-layer chunk cost before further performance tuning.
