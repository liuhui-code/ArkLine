# Index Deep-Layer Performance Gate v3 Plan

> **For agentic workers:** Use focused TDD slices. Keep new and touched code files under 500 lines.

**Goal:** Turn large-project deep indexing performance from manual `eprintln!`
inspection into structured, profiler-backed gates that preserve foreground
readiness and identify the slowest deep-layer stage.

**Architecture:** Keep existing indexing services unchanged unless profiling
evidence points to a measured hotspot. Add a small performance-gate service
that consumes stage samples from fixture/profile tests and produces diagnostics-
ready evidence. Large fixture tests remain explicit/ignored for expensive runs.

## Execution Plan

### Task 1: Structured Deep-Layer Telemetry Model

**Files:**

- Create: `src-tauri/src/services/workspace_index_performance_gate_service.rs`
- Create: `src-tauri/src/services/workspace_index_performance_gate_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] Add failing tests for stage samples, slowest-stage detection, and
  threshold violations.
- [x] Convert `WorkspaceStubRefreshProfile` into structured samples for stub
  parse, stub write, dependency graph, symbol resolution, and reference refresh.
- [x] Return diagnostics-ready evidence strings with stage, source, path count,
  duration, threshold, and chunk index.

### Task 2: Large Fixture Profile Gate Hook

**Files:**

- Modify: `src-tauri/src/services/workspace_large_fixture_service.rs`
- Modify: `src-tauri/src/services/workspace_large_update_profile_tests.rs`

- [x] Make ignored profile tests evaluate structured gate reports instead of
  printing only raw duration tuples.
- [x] Preserve existing raw profile output for manual investigation.
- [x] Keep generated fixture and real-project fixture comparison possible by
  carrying a `source` label in every sample.

### Task 3: Foreground Contract Boundary

**Files:**

- Modify: `src-tauri/src/services/workspace_large_project_index_tests.rs`

- [x] Add a fast regression gate proving foreground navigation readiness remains
  available before deep background refresh completes.
- [x] Keep the expensive 10,000-file profile as explicit/ignored work, not part
  of default tests.

### Task 4: First Hotspot Optimization Boundary

**Files:**

- Modify: `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`

- [x] Record that future optimization must start from the slowest reported
  stage and must not regress foreground file/symbol readiness.
- [x] Defer code optimization unless a gate report identifies a concrete
  measured hotspot.

### Task 5: Verification

- [x] Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_performance_gate_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests
wc -l src-tauri/src/services/workspace_index_performance_gate_service.rs src-tauri/src/services/workspace_index_performance_gate_service_tests.rs src-tauri/src/services/workspace_large_fixture_service.rs src-tauri/src/services/workspace_large_update_profile_tests.rs src-tauri/src/services/workspace_large_project_index_tests.rs src-tauri/src/lib.rs docs/superpowers/plans/2026-07-05-index-deep-layer-performance-gate-v3.md
git diff --check
```

## Completion Criteria

- Deep-layer profile output is structured enough for diagnostics UI and
  future real-project fixture comparison.
- Gate reports identify slowest stage and threshold violations.
- Large-project foreground readiness remains protected by a fast regression
  test.
- Future optimization is constrained to measured hotspot evidence.
