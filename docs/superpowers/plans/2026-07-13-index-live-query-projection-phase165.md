# Phase 165: Live Query Event Diagnostics Projection

## Goal

Make live query explain events visible in the diagnostics read model without waiting for a full diagnostics refresh.

## Why

Phase 164 emits `workspace-index-event` for query explain results. The frontend projection store received those events, but `IndexDiagnosticsCenter` still rendered the last fetched diagnostics object. A query miss could therefore be emitted live and still not update `Last explain` or the query event list until the next inspection call completed.

## Changes

- Added `explainSummary` to the workspace index projection store.
- Derived `lastExplainStatus` from the latest unified event with `scope=query`.
- Merged projection data into the diagnostics controller output.
- Changed batched `recordRecentEvents` to merge with existing live events instead of replacing them.
- Added regression coverage for live query events surviving slower diagnostics refreshes.

## Design Notes

- The diagnostics object remains the stable UI contract.
- The projection store owns live-event derivation.
- The controller merges projection state only for the active workspace root.
- Event identity is deduped by `eventId`, so refreshes and live delivery can arrive in either order.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-index-projection-store.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

- Use the same projection merge pattern for timeline sampling and slow-file evidence.
- Add a compact diagnostics timeline badge for recent query misses.
