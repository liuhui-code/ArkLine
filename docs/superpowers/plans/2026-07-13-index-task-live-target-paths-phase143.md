# Index Task Live Target Paths - Phase 143

## Goal

Expose bounded live task target paths so diagnostics actions can distinguish "this file is indexing" from "another file is indexing".

## Implemented

- Added backend task status fields:
  - `target_paths`
  - `target_path_count`
- Populated live queued/running task statuses from scheduler `changed_paths`.
- Kept task journal schema unchanged; loaded historical terminal statuses expose empty target metadata.
- Updated frontend action state to recognize real backend foreground navigation shape:
  - `kind=changed-paths`
  - `reason=foreground-navigation`
- Added Rust and frontend coverage for path-aware current-file action state.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-layer-actions.test.tsx tests/frontend/index-diagnostics-model.test.ts`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_manager_service_tests::queued_foreground_status_exposes_bounded_target_paths`
- `pnpm check:line-count`

## Next

- Display target path samples in Processes / Queue.
- Apply the same target-aware state to visible-file and completion-triggered indexing.
