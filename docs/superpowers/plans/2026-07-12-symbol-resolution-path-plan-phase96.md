# Symbol Resolution Path Plan Phase 96

## Goal

Keep symbol resolution's incremental path handling isolated from the database
orchestration service.

## Context

Symbol resolution is a core deep-index layer for definition, usages, and
completion. The service had already been reduced below the 500-line guard, but
incremental affected-path planning still lived inside the orchestration file.

## Change

- Added `workspace_symbol_resolution_path_plan_service.rs`.
- Added a focused test for path normalization, sorting, deduplication, and set
  construction.
- Replaced the local `affected_path_set` helper with
  `plan_symbol_resolution_paths`.
- Kept existing declaration-only and binding-aware refresh behavior unchanged.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_path_plan_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_query_service_tests`

## Next

The next symbol-resolution slice can extract unresolved-symbol insertion or
query-row loading, depending on which side is most useful for the next measured
large-project bottleneck.
