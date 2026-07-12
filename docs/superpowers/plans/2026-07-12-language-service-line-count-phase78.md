# Language Service Line Count Phase 78

## Goal

Move `language_service.rs` below the 500-line maintenance ceiling without changing language runtime behavior.

## Completed

- Extracted inline language runtime tests into `language_service_tests.rs`.
- Registered the external test module in `src-tauri/src/lib.rs`.
- Kept the public `language_service` API unchanged.
- Reused a single temp-path helper for worker and source test files.

## Verification

- Red check before implementation:
  - `node scripts/check-line-count.mjs --limit=500 --roots=src-tauri/src/services/language_service.rs,src-tauri/src/services/workspace_edit_service.rs`
- Focused checks:
  - `cargo test language_service_tests`
  - `node scripts/check-line-count.mjs --limit=500 --roots=src-tauri/src/services/language_service.rs,src-tauri/src/services/language_service_tests.rs,src-tauri/src/lib.rs`

## Remaining Backend Line-Count Debt

- `src-tauri/src/services/workspace_edit_service.rs`

## Next Step

Split workspace edit code by refactoring operation groups and shared edit builders into focused modules, keeping each new file below 500 lines.
