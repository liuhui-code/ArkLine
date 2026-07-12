# Phase 168: Live Index Error Status

## Goal

Surface live index errors in the status bar without requiring the user to open diagnostics first.

## Why

Phase 167 projected live error events into diagnostics health evidence. The status bar still used retry/backoff health only, so a fresh `severity=error` event could be visible inside diagnostics while the bottom status summary continued to show a normal index state.

## Changes

- Extended index health status formatting to accept `lastError`.
- Show `Index: Error, <message>` when no retry/backoff status is active.
- Keep retry/backoff higher priority than raw error messages because it is more actionable.
- Route `Index: Error` status bar clicks to the Health / Storage diagnostics section.
- Added focused model and controller tests.

## Verification

- `pnpm exec vitest run tests/frontend/app-shell-model.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

- Add compact repair-action hints near the error status when diagnostics can classify a direct next action.
