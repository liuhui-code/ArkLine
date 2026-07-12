# Workspace Edit Line Count Phase 79

## Goal

Bring `workspace_edit_service.rs` below the 500-line maintenance ceiling while preserving workspace edit preview and apply behavior.

## Completed

- Split path, readonly-directory, parent, and UTF-16 range validation into `workspace_edit_path_service.rs`.
- Split operation relationship conflict detection into `workspace_edit_relationship_service.rs`.
- Split affected-file and summary generation into `workspace_edit_summary_service.rs`.
- Moved workspace edit test fixtures into `workspace_edit_test_fixture_service.rs`.
- Split workspace edit tests into file operation and safety/relationship test modules.
- Extracted query path helpers after the backend-wide line-count check exposed `workspace_index_query_service.rs` at 505 lines.

## Verification

- Red check before implementation:
  - `node scripts/check-line-count.mjs --limit=500 --roots=src-tauri/src/services/workspace_edit_service.rs`
- Focused checks:
  - `cargo test workspace_edit`
  - `cargo test workspace_index_query_service_tests`
  - `node scripts/check-line-count.mjs --limit=500 --roots=src-tauri/src/services/workspace_edit_service.rs,src-tauri/src/services/workspace_edit_path_service.rs,src-tauri/src/services/workspace_edit_relationship_service.rs,src-tauri/src/services/workspace_edit_summary_service.rs,src-tauri/src/services/workspace_edit_file_ops_tests.rs,src-tauri/src/services/workspace_edit_safety_tests.rs,src-tauri/src/services/workspace_edit_test_fixture_service.rs,src-tauri/src/lib.rs`
  - `node scripts/check-line-count.mjs --limit=500 --roots=src-tauri/src/services,src-tauri/src/lib.rs`

## Maintenance Note

`src-tauri/src/lib.rs` is intentionally kept below 500 lines with compact `#[cfg(test)] mod ...;` declarations. If more backend modules are added, move service declarations into a dedicated `services/mod.rs` structure rather than growing `lib.rs`.
