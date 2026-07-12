# Index Process Target Path Display - Phase 144

## Goal

Make the diagnostics queue view explain which files an index task is targeting, using the live bounded target path metadata added in Phase 143.

## Implemented

- Added `formatTaskTargets` for compact target path summaries.
- Added a `Target` column to Processes / Queue.
- Displayed up to the backend-provided target path sample and `+N more` when the task targets more paths.
- Added section-level frontend coverage without growing the large center test file.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-processes-section.test.tsx tests/frontend/index-diagnostics-model.test.ts`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`
- `pnpm check:line-count`

## Next

- Highlight target paths that match the current editor file.
- Add target summaries to the active task strip for the status bar / diagnostics header path.
