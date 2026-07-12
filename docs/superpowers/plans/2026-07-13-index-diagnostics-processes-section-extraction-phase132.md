# Index Diagnostics Processes Section Extraction Phase 132

## Goal

Keep the Diagnostics Center maintainable while preserving the Processes / Queue evidence used to understand large-project indexing stalls.

## Changes

- Extracted Processes / Queue into `IndexDiagnosticsProcessesSection`.
- Preserved the existing section id, accessible region name, queue metrics, task table columns, stalled-row styling, and empty state.
- Reused the existing task progress, duration, and detail formatters.
- Reduced `IndexDiagnosticsCenter.tsx` from the 440-line range to the 410-line range.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx tests/frontend/index-diagnostics-navigation.test.tsx`
- `pnpm check:line-count`

## Next Slice

- Split Health / Storage once another diagnostics UI change needs more room.
