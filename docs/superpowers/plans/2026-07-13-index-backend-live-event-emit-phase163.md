# Phase 163: Index Backend Live Event Emit

## Goal

Emit backend unified index events through the `workspace-index-event` channel.

## Why This Phase

Phase 162 added the frontend live-event watcher. Without backend emits, the UI
could only consume unified events after a diagnostics refresh. This phase closes
that loop for task lifecycle and scheduler retry/backoff events produced while
the index manager stores task status.

## Changes

- `store_task_status_with_events` returns task and retry/backoff events written
  during the status update.
- The index manager exposes event-aware worker methods while keeping existing
  status-only wrappers.
- Workspace and foreground scheduling commands emit `workspace-index-event`
  alongside `workspace-index-task-updated`.
- SDK indexing command paths collect and emit unified events.
- Added regression coverage for retry/backoff events returned for live emit.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml repeated_failed_task_status_returns_retry_backoff_event_for_live_emit`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

Extend live event emission to query explain and performance/deep-layer events
that are currently persisted but only visible after diagnostics refresh.
