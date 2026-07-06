# Index Performance Diagnostics And First Hotspot Plan

> Keep this slice evidence-first. Do not optimize indexing internals until the
> structured performance report identifies a concrete slowest stage.

**Goal:** Surface deep-layer performance gate reports through the diagnostics
event stream, add an explicit current-project profile hook, preserve generated
versus project comparison evidence, and keep foreground readiness protected.

## Execution Plan

### Task 1: Diagnostics Timeline Integration

- [x] Add a unified `performance/deep-layer` index event generated from
  `WorkspaceIndexPerfGateReport`.
- [x] Keep Diagnostics Center integration through the existing timeline event
  path instead of adding UI-only state.
- [x] Add backend diagnostics test proving performance gate events appear in
  the timeline.

### Task 2: Current Project Profile Hook

- [x] Add an ignored profile test driven by `ARKLINE_PROFILE_ROOT`.
- [x] Produce `source=project` samples so real project output can be compared
  with generated fixture output.
- [x] Record the project profile report into the index event log for later
  diagnostics inspection.

### Task 3: Generated/Project Comparison Evidence

- [x] Preserve existing raw profile output.
- [x] Keep structured sample fields: source, stage, duration, path count, and
  chunk index.

### Task 4: First Hotspot Optimization Boundary

- [x] Require future optimization to start from `slowest_stage` and threshold
  violations.
- [x] Keep optimization separate from readiness/query correctness.

### Task 5: Verification

- [x] Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_performance_gate_service_tests
cargo test --manifest-path src-tauri/Cargo.toml reports_deep_layer_performance_gate_events_in_timeline
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests
wc -l src-tauri/src/services/workspace_index_performance_gate_service.rs src-tauri/src/services/workspace_index_performance_gate_service_tests.rs src-tauri/src/services/workspace_index_diagnostics_service_tests.rs src-tauri/src/services/workspace_large_update_profile_tests.rs docs/superpowers/plans/2026-07-05-index-performance-diagnostics-first-hotspot.md
git diff --check
```

## Current Project Profile Command

Run explicitly when profiling a real workspace:

```bash
ARKLINE_PROFILE_ROOT=/path/to/project cargo test --manifest-path src-tauri/Cargo.toml profiles_existing_workspace_persistence_chunk_stages -- --ignored --nocapture
```

The hook mutates the workspace `.arkline/index` cache as part of profiling. Run
it only on a project where rebuilding the ArkLine cache is acceptable.
