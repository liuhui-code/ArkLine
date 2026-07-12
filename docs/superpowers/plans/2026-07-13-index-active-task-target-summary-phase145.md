# Index Active Task Target Summary - Phase 145

## Goal

Surface live task target paths in the diagnostics active task strip, so users can understand what the current top index task is processing without scrolling to Processes / Queue.

## Implemented

- Added `targetSummary` to active task summaries.
- Reused bounded target path formatting from the process table.
- Rendered target summaries in the active task strip with a stable layout column.
- Added model and component coverage.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-active-task-strip.test.tsx tests/frontend/index-diagnostics-model.test.ts tests/frontend/index-diagnostics-repair-actions.test.tsx`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`
- `pnpm check:line-count`

## Next

- Highlight whether the active task target includes the current editor file.
- Use the same active-task target evidence in status bar hover or diagnostics entry points.
