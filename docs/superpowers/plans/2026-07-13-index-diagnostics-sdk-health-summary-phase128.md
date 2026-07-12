# Index Diagnostics SDK Health Summary Phase 128

## Goal

Show active SDK indexing evidence directly in Health / Storage so SDK stalls are visible without scanning the full process table.

## Changes

- Added a focused SDK task summary component for Diagnostics Center.
- Rendered active SDK indexing status, progress, duration, and detail inside Health / Storage.
- Added a stalled SDK regression test in a new focused test file to avoid growing the near-limit diagnostics center test.
- Kept `IndexDiagnosticsCenter.tsx` below the 500-line maintenance limit.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-sdk-health.test.tsx tests/frontend/index-diagnostics-center.test.tsx`

## Next Slice

- Add Health-level project task summary if users need the same direct evidence for project rebuild stalls.
