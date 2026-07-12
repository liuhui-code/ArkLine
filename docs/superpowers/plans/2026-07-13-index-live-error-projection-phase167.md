# Phase 167: Live Index Error Projection

## Goal

Project live unified index error events into diagnostics health evidence immediately.

## Why

The backend diagnostics service derives `last_error` from recent unified events, but the frontend diagnostics center can show stale `Last error` until the next `inspectWorkspaceIndex` call finishes. During large-project indexing, failure evidence should appear as soon as the live event arrives.

## Changes

- Added `errorSummary` to the workspace index projection store.
- Derived `lastError` from the latest unified event with `severity=error`.
- Merged projected `lastError` into the active workspace diagnostics object.
- Added focused tests for store derivation and controller diagnostics merge.

## Design Notes

- The durable source of truth remains the backend event log.
- The frontend projection only closes the live UI latency gap.
- The diagnostics UI contract stays unchanged through `WorkspaceIndexDiagnostics`.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-index-projection-store.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

- Add live repair-action hints for repeated failures.
- Surface recent error evidence in the diagnostics header when present.
