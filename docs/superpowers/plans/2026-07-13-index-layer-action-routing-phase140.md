# Index Layer Action Routing Phase 140

## Goal

Close the loop between layer readiness recommendations and executable diagnostics actions so the Diagnostics Center is actionable instead of only descriptive.

## Changes

- Render executable layer actions as buttons in `IndexDiagnosticsLayersSection`.
- Keep non-executable `wait` recommendations as stable text.
- Route layer actions in `IndexDiagnosticsCenter` rather than binding the layer table to workspace APIs.
- Connected:
  - `rebuildIndex` to project index rebuild
  - `configureSdk` to settings
  - `indexCurrentFile` to foreground current-file indexing
  - `inspectParserFailures` to the parser failures section
- Added controller support for scheduling foreground navigation indexing for the active file.
- Added focused tests for layer action buttons and current-file index scheduling.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-layer-actions.test.tsx tests/frontend/use-index-diagnostics-layer-actions.test.tsx`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next Step

Add richer action-state feedback, such as disabling current-file indexing while a foreground task is already queued or running for the same path.
