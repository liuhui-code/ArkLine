# Index Diagnostics Performance Timeline Section Extraction Phase 135

## Goal

Keep the diagnostics center composition layer small while preserving the user-facing performance evidence needed to diagnose slow search, jump, render, IPC, and index task behavior.

## Changes

- Extracted `IndexDiagnosticsPerformanceTimelineSection` from `IndexDiagnosticsCenter`.
- Preserved the `Performance Timeline` region id, aria label, event count, severity badges, and empty state.
- Kept render pressure, IPC latency, UI latency, and backend index timeline evidence in one dedicated section.
- Left timeline counting in `index-diagnostics-model` so the parent still owns cross-source aggregation.
- Reduced `IndexDiagnosticsCenter.tsx` toward a pure orchestration component under the 500-line limit.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx`
- `pnpm check:line-count`

## Next Step

Extract parser errors and unresolved imports into focused diagnostics evidence sections if the center continues to grow.
