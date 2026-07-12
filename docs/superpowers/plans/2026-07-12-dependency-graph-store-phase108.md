# Dependency Graph Store Phase 108

## Goal

Keep dependency graph indexing maintainable by separating graph algorithms from SQLite row loading and persistence.

## Scope

- Extract dependency graph store helpers into `workspace_dependency_graph_store_service`.
- Move import and re-export row loading, dependency edge writes, unresolved import writes, and graph metadata status reads/writes behind that store boundary.
- Preserve the existing public `load_dependency_graph_status` API through `workspace_dependency_graph_service`.
- Add focused store tests for row loading, edge/reverse writes, unresolved imports, and metadata status round trip.

## Result

- `workspace_dependency_graph_service.rs` dropped from 432 lines to 299 lines.
- Dependency graph indexing logic now depends on store helpers instead of owning SQL row details directly.
- Existing dependency graph behavior remains covered by service tests.

## Verification

- `cargo test workspace_dependency_graph_store_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_dependency_graph_service_tests --manifest-path src-tauri/Cargo.toml`
- `pnpm check:fast`

## Next Candidate

Only one index-core file remains above the 430-line band:

- `workspace_index_service.rs`
