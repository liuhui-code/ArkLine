# Index Live Repair Action Projection Phase 170

## Goal

Surface stable repair hints from live workspace index events before the slower full
diagnostics refresh has copied those hints into `repairActions`.

## Context

The status bar already prioritizes:

1. retry backoff
2. last error
3. repair actions

However, repair actions previously depended on full diagnostics. A live
definition miss could carry `recommendedAction: "rebuildIndex"` immediately, but
the status bar stayed silent until diagnostics refreshed.

## Implementation

- Added `repairSummary` to the workspace index projection snapshot.
- Derived repair hints from query explain event payloads.
- Mapped only stable actions:
  - `rebuildIndex` -> `rebuildProjectIndex`
  - `configureSdk` -> `configureSdk`
- Merged projected repair actions into effective diagnostics before status
  summary calculation.

## Guardrails

- `wait`, `openFile`, and `reportBug` are intentionally not elevated to status
  bar repair actions yet.
- Backoff and error status still take priority over repair actions.
- Full diagnostics remains the source of truth when no live repair hint exists.

## Verification

- `tests/frontend/workspace-index-projection-store.test.ts`
- `tests/frontend/use-index-diagnostics-health-summary.test.tsx`

