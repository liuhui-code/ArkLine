# Rust Index Scheduler Line Count Phase 77

## Goal

Bring the index scheduler backend file below the 500-line maintenance ceiling while making the line-count guard able to target backend files directly.

## Completed

- Extended `scripts/check-line-count.mjs` so `collectProjectFiles` accepts explicit file roots.
- Added `--roots=` CLI support for focused line-count checks.
- Moved `workspace_index_scheduler_service` tests into `workspace_index_scheduler_service_tests.rs`.
- Registered the external scheduler test module in `src-tauri/src/lib.rs`.

## Verification

- Red check before implementation:
  - `node scripts/check-line-count.mjs --limit=500 --roots=src-tauri/src/services/workspace_index_scheduler_service.rs`
- Focused tests:
  - `./node_modules/.bin/vitest run tests/frontend/check-line-count.test.mjs`
  - `cargo test workspace_index_scheduler_service_tests`
- Focused line-count check:
  - `node scripts/check-line-count.mjs --limit=500 --roots=src-tauri/src/services/workspace_index_scheduler_service.rs,src-tauri/src/services/workspace_index_scheduler_service_tests.rs,scripts/check-line-count.mjs,tests/frontend/check-line-count.test.mjs`

## Remaining Backend Line-Count Debt

- `src-tauri/src/services/language_service.rs`
- `src-tauri/src/services/workspace_edit_service.rs`

## Next Step

Split the remaining large Rust services by stable responsibility boundaries, starting with the lowest-risk helper or test extraction that preserves existing public service APIs.
