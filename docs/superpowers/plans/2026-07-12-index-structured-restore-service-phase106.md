# Index Structured Restore Service Phase 106

## Goal

Make the large-project open path easier to evolve by separating structured SQLite restore from index persistence writes and JSON fallback logic.

## Scope

- Extract structured SQLite restore into `workspace_index_structured_restore_service`.
- Keep `workspace_index_persistence_service` responsible for persistence orchestration and fallback selection.
- Add focused tests for restoring files, symbols, metadata, and empty structured-cache miss behavior.
- Preserve existing service-level restore coverage.

## Result

- `workspace_index_persistence_service.rs` dropped from 443 lines to 366 lines.
- Structured restore now has a direct test surface for future large-project restore optimization.
- JSON fallback behavior remains owned by the persistence service.

## Verification

- `cargo test workspace_index_structured_restore_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_service_tests --manifest-path src-tauri/Cargo.toml`
- `pnpm check:fast`

## Next Candidate

Continue reducing the remaining 430+ line index services:

- `workspace_index_layer_readiness_service.rs`
- `workspace_index_service.rs`
- `workspace_dependency_graph_service.rs`
