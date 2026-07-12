# Phase 158: Index Backoff Health Projection

## Goal

Make retry/backoff evidence available through the lightweight index health path
so the status bar does not depend on opening the full diagnostics center first.

## Why This Phase

Phase 157 taught the status bar how to display loaded backoff evidence, but the
evidence source was still full diagnostics. Large-project IDE chrome should
consume small projections when possible. Health is the right contract for this
summary-level state.

## Changes

- Added `retryBackoffCount` and `latestRetryBackoff` to `WorkspaceIndexHealth`.
- Projected existing diagnostics retry evidence into the health service.
- Refreshed health after terminal index task status updates in the diagnostics
  controller.
- Used the health projection before full diagnostics when deriving status-bar
  index text.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests::reports_retry_backoff_in_health`
- `pnpm exec vitest run tests/frontend/use-index-diagnostics-controller.test.tsx tests/frontend/workspace-api.test.ts`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

The next slice should avoid even terminal-event-triggered pulls by publishing a
bounded health projection from unified index events into the frontend projection
store.
