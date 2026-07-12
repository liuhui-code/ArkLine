# Index Layer Readiness Store Phase 107

## Goal

Keep index readiness diagnostics maintainable by separating SQLite store access from layer projection logic.

## Scope

- Extract layer readiness store helpers into `workspace_index_layer_readiness_store_service`.
- Move row existence checks, row counts, distinct path counts, index-store opening, and path normalization behind that store boundary.
- Keep `workspace_index_layer_readiness_service` focused on readiness report construction.
- Add focused store tests for count, distinct path, row existence, and path normalization behavior.

## Result

- `workspace_index_layer_readiness_service.rs` dropped from 443 lines to 388 lines.
- Store-level query semantics now have direct regression coverage.
- The readiness report behavior remains covered by existing service tests.

## Verification

- `cargo test workspace_index_layer_readiness_store_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_layer_readiness_service_tests --manifest-path src-tauri/Cargo.toml`
- `pnpm check:fast`

## Next Candidate

The remaining large index-core files are now:

- `workspace_index_service.rs`
- `workspace_dependency_graph_service.rs`
