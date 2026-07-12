# Index Diagnostics Targeted Open Phase 127

## Goal

Connect status bar index entry points to the Diagnostics Center section navigation so users land near the most relevant evidence.

## Changes

- Added a diagnostics section target to the index diagnostics controller.
- Passed the target through AppShell status surfaces into the Diagnostics Center.
- Made project index status clicks target Processes / Queue.
- Made SDK index status clicks target Health / Storage.
- Added Diagnostics Center scroll behavior for requested section ids.
- Split controller coverage into a focused test file to keep the existing test file below 500 lines.

## Verification

- `pnpm exec vitest run tests/frontend/shell-status-bar.test.tsx tests/frontend/use-index-diagnostics-section-target.test.tsx tests/frontend/index-diagnostics-navigation.test.tsx tests/frontend/index-diagnostics-center.test.tsx`

## Next Slice

- If SDK stalled cases need more direct visibility, add a dedicated SDK task summary inside Health / Storage rather than making users infer it from queue rows.
