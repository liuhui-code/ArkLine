# Index Status Progress Phase 119

## Goal

Use the active project index task summary in the status-bar index text so users
can see rebuild progress before opening the Diagnostics Center.

## Changes

- Reused the active project task summary model from diagnostics.
- Kept discovery-specific wording unchanged.
- Updated project task status text to include percentage progress, for example
  `Index: running project · 4/10 (40%)`.

## Verification

- `pnpm exec vitest run tests/frontend/app-shell-model.test.ts --testNamePattern "formats index"`
- `pnpm build`

## Next Slice

Expose the same active task summary in the Health / Storage repair area when a
repair action is currently running, so users do not repeatedly click rebuild
while a queued task is already active.
