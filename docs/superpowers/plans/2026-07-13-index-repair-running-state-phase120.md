# Index Repair Running State Phase 120

## Goal

Prevent duplicate project-index rebuild requests from the Diagnostics Center
when a project index task is already active.

## Changes

- Health / Storage repair actions now detect the active project index task.
- `Rebuild Project Index` becomes a disabled `Running Project Index` button
  while project indexing is active.
- The repair action shows the active task progress beside the disabled button.
- Added a focused repair-action test in a separate file to keep existing test
  files under the 500-line limit.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-repair-actions.test.tsx`
- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx tests/frontend/index-diagnostics-model.test.ts`
- `pnpm build`

## Next Slice

Apply the same guarded repair pattern to SDK indexing once SDK task status needs
the same anti-repeat behavior.
