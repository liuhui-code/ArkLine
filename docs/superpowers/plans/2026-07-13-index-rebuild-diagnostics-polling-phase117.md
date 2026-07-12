# Index Rebuild Diagnostics Polling Phase 117

## Goal

Keep Diagnostics Center task evidence fresh after a project-index rebuild repair
without requiring manual refresh.

## Why This Phase

Phase 116 moved project rebuild repair onto the manager queue, which made real
task status evidence available. The frontend still only fetched task statuses
once after the repair click, so a queued/running rebuild could become terminal
without the diagnostics panel reflecting it.

## Changes

- Added diagnostics rebuild polling in `useIndexDiagnosticsController`.
- The poll starts after `rebuildProjectIndexFromDiagnostics`.
- Each poll refreshes manager task statuses through the existing projection
  store.
- Polling stops when no non-terminal project-index task remains.
- Terminal project statuses continue to refresh layer readiness through the
  existing `refreshWorkspaceIndexTaskStatuses` path.

## Verification

- `pnpm exec vitest run tests/frontend/use-index-diagnostics-controller.test.tsx --testNamePattern "polls task statuses"`
- `pnpm exec vitest run tests/frontend/use-index-diagnostics-controller.test.tsx`
- `pnpm build`

## Next Slice

Surface the active rebuild task more explicitly in the Diagnostics Center header
or repair section, so users can see repair progress without scanning the
Processes / Queue table.
