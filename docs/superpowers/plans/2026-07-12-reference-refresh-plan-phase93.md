# Reference Refresh Plan Phase 93

## Goal

Keep the reference-index refresh path maintainable under the 500-line file
limit while preparing the next deep-layer performance slices.

## Context

The indexing roadmap identifies reference refresh, symbol resolution, stub
insert, and dependency graph updates as the remaining deep-layer performance
areas. `workspace_reference_index_service.rs` was close to the 500-line guard,
so adding more optimization logic there would make later changes fragile.

## Change

- Added `workspace_reference_refresh_plan_service.rs`.
- Added a focused test for affected-path planning.
- Moved reference refresh path normalization, sorting, deduplication, and set
  construction behind `plan_reference_refresh_paths`.
- Reused the same plan from normal incremental refresh and the profiling refresh
  path.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_refresh_plan_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_receiver_tests`

## Next

The next reference-index slice can extract content loading and member-context
readiness from `workspace_reference_index_service.rs`, then profile whether
real projects still pay duplicate file IO or global context-loading costs.
