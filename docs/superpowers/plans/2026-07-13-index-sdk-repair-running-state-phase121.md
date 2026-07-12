# Index SDK Repair Running State Phase 121

## Goal

Prevent duplicate SDK-index rebuild requests from the Diagnostics Center when
an SDK indexing task is already active.

## Changes

- Added an active SDK task summary model using the same progress, duration, and
  detail formatting as project index tasks.
- Health / Storage repair actions now disable `Rebuild SDK Index` while SDK
  indexing is active.
- The disabled SDK repair action shows `Running SDK Index` plus current progress.
- Extended focused repair-action coverage without growing existing large test
  files past the 500-line limit.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-repair-actions.test.tsx`
- `pnpm exec vitest run tests/frontend/index-diagnostics-model.test.ts tests/frontend/index-diagnostics-center.test.tsx`
- `pnpm build`
- `pnpm check:fast`

## Next Slice

Make the active task strip include SDK task evidence when only SDK indexing is
running, so SDK progress is visible above the fold, not just inside Health /
Storage.
