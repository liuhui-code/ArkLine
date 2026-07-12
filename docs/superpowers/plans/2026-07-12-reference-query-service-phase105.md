# Reference Query Service Phase 105

## Goal

Keep the reference indexing pipeline maintainable by separating refresh/write orchestration from query/read-model concerns.

## Scope

- Extract reference query row model and SQL lookup functions from `workspace_reference_index_service`.
- Move reference query path normalization, catalog database path resolution, source-file checks, and bounded query limit helpers into the new query service.
- Preserve the existing public query entry points through `workspace_reference_index_service` re-exports.
- Add focused tests for query limit clamping and workspace catalog path resolution.

## Result

- `workspace_reference_index_service.rs` dropped from 455 lines to 338 lines.
- New `workspace_reference_query_service.rs` owns reference read-model SQL and query helper boundaries.
- Existing reference index behavior remains covered by focused regression tests.

## Verification

- `cargo test workspace_reference_query_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_reference_index_service_tests --manifest-path src-tauri/Cargo.toml`
- `pnpm check:fast`

## Next Candidate

Continue reducing 430+ line index core files. The next likely candidates are:

- `workspace_index_persistence_service.rs`
- `workspace_index_layer_readiness_service.rs`
- `workspace_index_service.rs`
- `workspace_dependency_graph_service.rs`
