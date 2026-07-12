# Phase 166: Live Index Timeline Projection

## Goal

Project live unified index events into the diagnostics performance timeline without waiting for a full diagnostics refresh.

## Why

The backend diagnostics service already builds `timeline` from recent unified events, but the frontend diagnostics center rendered only the last fetched diagnostics object. During large-project indexing, live task events could update health and query evidence while the Performance Timeline stayed stale.

## Changes

- Added a frontend timeline projection to `workspace-index-projection-store`.
- Derived task phase durations using the same task-id based previous-event rule as the backend diagnostics service.
- Merged projected timeline data into the diagnostics controller output for the active workspace root.
- Preserved event merge/dedupe semantics so live events and diagnostics refreshes can arrive in either order.
- Added focused regression coverage for store timeline projection and controller diagnostics merge.

## Design Notes

- The UI still receives a `WorkspaceIndexDiagnostics` object.
- The projection store owns live-event derivation.
- The backend remains the durable source of truth; frontend projection only closes the UI latency gap.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-index-projection-store.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

- Add compact slow-event badges in the diagnostics header.
- Feed slow-file and repeated-retry evidence into the same live timeline path when backend emits those events.
