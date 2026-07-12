# Index SDK Stalled Status Phase 124

## Goal

Expose stalled SDK indexing directly in the status bar instead of showing an ambiguous running state.

## Changes

- Added status text coverage for a stalled SDK indexing task.
- Reused the diagnostics task detail text so the status bar says `No heartbeat > 60s`.
- Kept normal SDK progress and ready symbol-count behavior unchanged.

## Verification

- `pnpm exec vitest run tests/frontend/app-shell-model.test.ts --testNamePattern "formats index"`

## Next Slice

- Consider a compact status bar tooltip or click target that opens Diagnostics Center with the active SDK task preselected.
