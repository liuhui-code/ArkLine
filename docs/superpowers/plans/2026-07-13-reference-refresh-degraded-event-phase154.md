# Phase 154: Reference Refresh Degraded Event

## Goal

Record oversized reference-refresh content skips as production diagnostics
events.

## Why

Phase 152 bounded source loading for reference refresh, and Phase 153 surfaced
that evidence in performance profiles. The production indexing path also needs
durable evidence when reference coverage is degraded, otherwise users can see
partial usages or definition evidence without knowing that oversized files were
intentionally skipped to keep large projects responsive.

## Changes

- Added `store_index_event_in_connection` so index services can record unified
  events inside the active SQLite transaction.
- Recorded `index/reference-refresh/degraded` warning events when reference
  refresh skips oversized source files.
- Kept event payloads bounded with counts and a small skipped-path sample.
- Added regression coverage through a real workspace refresh and diagnostics
  readback.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_event_service_tests`
- `pnpm check:line-count`
- `pnpm check:fast`
