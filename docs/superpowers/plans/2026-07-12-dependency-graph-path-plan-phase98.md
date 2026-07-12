# Dependency Graph Path Plan Phase 98

## Goal

Keep the dependency graph indexing path maintainable by moving incremental changed-path planning out of `workspace_dependency_graph_service.rs`.

## Why

Large-project indexing depends on cheap incremental refresh decisions. The dependency graph service was close to the 500-line ceiling and mixed path normalization, changed-path set construction, SQL row loading, graph cleanup, and graph writes. That makes later performance fixes riskier because small path-planning changes can accidentally disturb graph persistence.

## Scope

- Add a small path planning service for dependency graph updates.
- Normalize path separators before dependency refresh planning.
- Sort and dedupe affected paths so incremental work remains deterministic.
- Preserve a separate removed-path set for stale graph cleanup decisions.
- Keep existing dependency graph behavior covered by focused tests.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_dependency_graph_path_plan_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_dependency_graph_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_dependency_graph_refresh_plan_service_tests`
- `pnpm check:fast`
