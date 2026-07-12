# Index Cache Path Service Phase 99

## Goal

Move workspace index cache path construction out of the persistence service so persistence can continue evolving below the 500-line ceiling.

## Why

`workspace_index_persistence_service.rs` was at 499 lines. That is risky for long-term index work because future fixes to large-project persistence, restore, or cache migration could break the line-count gate before the code is structurally healthier.

## Scope

- Add a small cache path service for JSON and SQLite catalog paths.
- Centralize root key normalization for persistence fallback paths.
- Keep persistence SQL, schema behavior, and restore semantics unchanged.
- Add focused tests for stable path construction and root key normalization.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_cache_path_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_query_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests`
- `pnpm check:fast`
