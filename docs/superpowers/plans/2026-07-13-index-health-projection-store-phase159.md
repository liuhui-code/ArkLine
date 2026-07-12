# Phase 159: Index Health Projection Store

## Goal

Move lightweight index health evidence into the shared workspace index
projection store.

## Why This Phase

Phase 158 refreshed health after terminal task updates, but the evidence lived
inside the diagnostics controller. A mature IDE shell needs one bounded
projection source for task status, refresh results, and health summaries so
status bar consumers do not depend on controller-local state.

## Changes

- Added `healthSummary` to `workspaceIndexProjectionStore`.
- Added `recordHealthSummary` for bounded health updates.
- Changed diagnostics controller status derivation to read health evidence from
  the shared projection snapshot.
- Added a focused projection-store test proving health survives task and refresh
  projection updates.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-index-projection-store.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx tests/frontend/use-index-diagnostics-controller.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

The next slice can publish bounded health summaries from unified index events or
task-status watcher payloads directly into this projection store.
