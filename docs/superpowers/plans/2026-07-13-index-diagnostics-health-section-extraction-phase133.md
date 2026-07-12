# Index Diagnostics Health Section Extraction Phase 133

## Goal

Keep Health / Storage maintainable as index repair, schema, SDK, and storage diagnostics keep growing.

## Changes

- Extracted Health / Storage into `IndexDiagnosticsHealthSection`.
- Preserved the existing section id, accessible region name, metrics, SDK/project task summaries, schema rebuild table, repair actions, disabled running states, and empty state.
- Kept `IndexDiagnosticsCenter.tsx` focused on composition and reduced it to the 340-line range.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx tests/frontend/index-diagnostics-repair-actions.test.tsx tests/frontend/index-diagnostics-project-health.test.tsx tests/frontend/index-diagnostics-sdk-health.test.tsx tests/frontend/index-diagnostics-navigation.test.tsx`
- `pnpm check:line-count`

## Next Slice

- Extract Query Explain or Performance Timeline if either section needs more UI evidence.
