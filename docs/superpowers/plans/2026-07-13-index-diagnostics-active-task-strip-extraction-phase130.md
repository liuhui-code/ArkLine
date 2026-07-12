# Index Diagnostics Active Task Strip Extraction Phase 130

## Goal

Restore line-count headroom in `IndexDiagnosticsCenter.tsx` before adding more diagnostics UI.

## Changes

- Extracted the active index task header strip into `IndexDiagnosticsActiveTaskStrip`.
- Preserved the existing `Active Index Task` accessibility label and visual classes.
- Kept task summary formatting in `index-diagnostics-model.ts`.
- Reduced `IndexDiagnosticsCenter.tsx` away from the 500-line ceiling.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx tests/frontend/index-diagnostics-repair-actions.test.tsx`
- `pnpm check:line-count`

## Next Slice

- Continue extracting large Diagnostics Center sections before adding new UI-only evidence.
