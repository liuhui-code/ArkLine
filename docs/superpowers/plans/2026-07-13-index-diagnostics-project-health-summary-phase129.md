# Index Diagnostics Project Health Summary Phase 129

## Goal

Show active project indexing evidence directly in Health / Storage so project rebuild, open-workspace, and background refresh stalls are visible without scanning the full process table.

## Changes

- Replaced the SDK-only health task summary with a reusable health task summary component.
- Rendered active project indexing status, progress, duration, and detail inside Health / Storage.
- Kept the SDK health summary behavior and accessibility label intact.
- Added a focused project health regression test in a new file to avoid growing near-limit diagnostics tests.
- Kept `IndexDiagnosticsCenter.tsx` below the 500-line maintenance limit.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-project-health.test.tsx tests/frontend/index-diagnostics-sdk-health.test.tsx tests/frontend/index-diagnostics-center.test.tsx`

## Next Slice

- Move the active-task header strip into a small component if the diagnostics center needs another UI addition.
