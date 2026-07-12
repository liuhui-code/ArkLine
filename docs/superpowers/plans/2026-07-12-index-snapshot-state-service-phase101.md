# Index Snapshot State Service Phase 101

## Goal

Move snapshot-to-index-state construction out of `workspace_index_service.rs` so the runtime service stays focused on orchestration.

## Why

`workspace_index_service.rs` was 486 lines and repeated state construction for full refresh, open refresh, and incremental replacement. That logic controls normalized paths, ready/partial status, indexed time, symbols, and partial reasons, so duplicating it makes later large-project indexing changes easier to drift.

## Scope

- Add `workspace_index_snapshot_state_service.rs`.
- Centralize snapshot path normalization and state construction.
- Keep symbol indexing, persistence, content indexing, and fingerprint side effects in the runtime service.
- Add focused tests for normalized paths, symbol preservation, and truncated-scan partial state.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_snapshot_state_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_service_tests`
- `pnpm check:fast`
