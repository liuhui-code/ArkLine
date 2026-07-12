# Phase 155: Index Retry Backoff Diagnostics

## Goal

Add the first retry/backoff diagnostics slice for repeated index task failures.

## Why

The indexing roadmap still calls out mature retry/backoff handling as a missing
scheduler capability. Jumping straight to automatic retry risks hiding failures
or creating retry loops. This phase adds a pure policy and durable diagnostic
event first, so repeated failures become visible and future scheduling changes
can consume the same policy.

## Changes

- Added `workspace_index_retry_policy_service` with a bounded backoff sequence.
- Classified consecutive failures by root, task kind, and task reason.
- Stored `scheduler/<kind>/backoff` warning events after repeated failed task
  statuses.
- Kept current scheduling behavior unchanged; the event records a recommended
  retry delay instead of automatically rescheduling work.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_retry_policy_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_task_journal_service_tests`
- `pnpm check:line-count`
- `pnpm check:fast`
