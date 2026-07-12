# Phase 156: Index Retry Backoff Health

## Goal

Surface retry/backoff diagnostics as a Health / Storage summary.

## Why

Phase 155 records repeated index task failures as unified scheduler events. Raw
timeline events are useful for developers, but users need a compact current
state in Diagnostics Center. This phase lifts retry backoff evidence into the
diagnostics model and Health / Storage surface.

## Changes

- Added `retryBackoffCount` and `latestRetryBackoff` to workspace index
  diagnostics.
- Aggregated recent `scheduler/*/backoff` events in the backend diagnostics
  service.
- Displayed retry backoff status in the Health / Storage metrics grid.
- Added focused backend and frontend coverage.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_diagnostics_retry_tests`
- `pnpm exec vitest run tests/frontend/index-diagnostics-project-health.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`
