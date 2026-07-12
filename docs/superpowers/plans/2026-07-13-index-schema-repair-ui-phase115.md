# Index Schema Repair UI Phase 115

## Goal

Make schema-version rebuild repair actionable from the Index Diagnostics Center.

## Why This Phase

Phase 114 connected backend schema policy to `rebuildProjectIndex`, but the UI
still needed to show which schema domains forced the repair and route the
Diagnostics Center button through a diagnostics-owned rebuild flow.

## Changes

- Render schema domains whose version policy reports `needs-rebuild` in Health /
  Storage.
- Show the persisted-to-expected version transition for each incompatible
  schema domain.
- Added a diagnostics-specific `rebuildProjectIndexFromDiagnostics` controller
  action.
- Diagnostics rebuild now requests project index rebuild and refreshes
  diagnostics evidence afterward.
- AppShell routes the Diagnostics Center project rebuild button through the
  diagnostics-specific action instead of borrowing the explain-panel handler.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx --testNamePattern "schema version rebuild"`
- `pnpm exec vitest run tests/frontend/use-index-diagnostics-controller.test.tsx --testNamePattern "rebuilds project index from diagnostics"`
- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx tests/frontend/use-index-diagnostics-controller.test.tsx`
- `pnpm build`

## Next Slice

The next diagnostics slice should connect repair action progress more tightly to
task status: after a rebuild request, keep the Diagnostics Center focused on the
queued/running task and surface terminal success or failure without requiring a
manual refresh.
