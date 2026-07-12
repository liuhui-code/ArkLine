# Phase 161: Index Backoff Event Projection

## Goal

Let the frontend projection store consume backend unified index events as a
real-time health source.

## Why This Phase

Phase 160 derived retry backoff from task-status sequences so the status bar did
not wait for a health refresh. That is useful, but it is still a frontend
guess. The mature path is to let backend unified events become the shared
runtime evidence stream.

## Changes

- Projection snapshots now retain recent backend index events.
- Scheduler `backoff` events derive retry-backoff health summaries.
- Diagnostics refresh now records `recentEvents` into the projection store after
  loading backend diagnostics.
- Added focused store and controller coverage for backend-event projection.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-index-projection-store.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

Add a backend live-event subscription path so the UI can consume unified events
without waiting for an explicit diagnostics refresh.
