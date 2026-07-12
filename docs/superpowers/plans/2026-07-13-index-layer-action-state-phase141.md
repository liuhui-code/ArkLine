# Index Layer Action State - Phase 141

## Goal

Make Index Diagnostics layer actions reflect active index work so users do not repeatedly submit the same expensive operation while indexing is already queued or running.

## Implemented

- Added a shared `getLayerActionState` model helper.
- Disabled `Index Current File` while a `foreground-navigation` task is active.
- Disabled project rebuild actions while non-SDK project indexing is active.
- Disabled SDK actions while SDK indexing is active.
- Kept disabled actions visible with an explicit reason and progress text.
- Added frontend coverage for current-file action busy state.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-layer-actions.test.tsx tests/frontend/use-index-diagnostics-layer-actions.test.tsx`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`

## Next

- Add backend-level action availability metadata when task statuses include changed-path details.
- Surface action state in status bar summaries for stalled and degraded index states.
