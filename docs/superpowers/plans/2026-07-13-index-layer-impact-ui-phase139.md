# Index Layer Impact UI Phase 139

## Goal

Make the Diagnostics Center layer table easier to read by showing which IDE capabilities each index layer affects.

## Changes

- Added an `Impact` column to `IndexDiagnosticsLayersSection`.
- Mapped layer names to concise IDE capability labels such as quick open, text search, navigation, completion, usages, SDK API, and incremental refresh.
- Kept long backend reason text under the action column so the table remains dense but still explains failures.
- Updated the layer grid to support the extra column without changing the surrounding diagnostics shell.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`
- `pnpm check:line-count`

## Next Step

Connect recommended layer actions to targeted commands where possible, especially `indexCurrentFile`, `inspectParserFailures`, and `configureSdk`.
