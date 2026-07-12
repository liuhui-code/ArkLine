# Index Metadata Restore Service Phase 102

## Goal

Move SQLite index metadata restore logic out of `workspace_index_persistence_service.rs`.

## Why

Persistence was still one of the largest index services. Metadata restore is a separate responsibility from catalog persistence: it maps persisted status text, indexed generation, and partial reasons back into the runtime index state. Keeping it isolated makes future persistence changes safer.

## Scope

- Add `workspace_index_metadata_restore_service.rs`.
- Move metadata row loading and status text parsing into the helper.
- Preserve existing fallback behavior where unknown status maps to `Empty`.
- Keep structured SQLite catalog restore behavior unchanged.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_metadata_restore_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_service_tests`
- `pnpm check:fast`
