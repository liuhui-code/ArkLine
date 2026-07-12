# Index SDK Active Strip Phase 122

## Goal

Show SDK indexing progress above the fold in the Index Diagnostics Center when
SDK indexing is the only active index task.

## Changes

- The active task strip now uses project index tasks first and falls back to SDK
  index tasks when no project task is active.
- Added focused coverage proving SDK-only indexing shows title, kind, progress,
  and duration in the top status strip.
- Preserved the existing project-task priority, so project indexing remains the
  first signal when both project and SDK work are active.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-repair-actions.test.tsx`
- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx tests/frontend/index-diagnostics-model.test.ts`
- `pnpm build`
- `cargo test --manifest-path src-tauri/Cargo.toml services::workspace_index_manager_service_tests::background_worker_processes_task_scheduled_before_start -- --exact`
- `pnpm check:fast`

## Note

The first `pnpm check:fast` run hit a transient Rust temp-directory cleanup
failure in `background_worker_processes_task_scheduled_before_start`. The focused
test passed immediately afterward, and the full `pnpm check:fast` rerun passed.
