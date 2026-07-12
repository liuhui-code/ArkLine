# Phase 160: Index Task Event Backoff Projection

## Goal

Derive bounded retry/backoff status from task-status events before a health
refresh is available.

## Why This Phase

Phase 159 moved health evidence into the shared projection store. The next IDE
responsiveness gap is latency: after repeated task failures, the status bar
should not wait for a separate health request before showing that indexing is in
backoff.

## Changes

- Projection store now derives retry backoff health from consecutive failed task
  statuses with the same root, kind, and reason.
- Non-failed terminal task statuses clear event-derived backoff state.
- Added focused store and controller tests for event-derived backoff.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-index-projection-store.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

Backend-emitted unified index events can later replace this frontend derivation
as the authoritative real-time source. Until then, the health refresh remains
the backend-correcting path.
