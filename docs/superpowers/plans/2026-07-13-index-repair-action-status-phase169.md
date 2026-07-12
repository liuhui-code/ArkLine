# Phase 169: Index Repair Action Status

## Goal

Surface actionable repair hints in the status bar when diagnostics already knows the next index repair action.

## Why

Diagnostics can classify repair actions such as rebuilding the project index or configuring the SDK, but the status bar previously showed those only after opening Health / Storage. For large projects, users need to see that the index needs a concrete action without hunting through the diagnostics panel.

## Changes

- Extended index health status formatting to include `repairActions`.
- Added `Index: Needs <repair action>` status text when no higher-priority backoff or error state exists.
- Routed `Index: Needs ...` clicks to the Health / Storage diagnostics section.
- Kept priority order: Backoff > Error > Needs Repair > layer/task/default status.
- Added focused model and controller tests.

## Verification

- `pnpm exec vitest run tests/frontend/app-shell-model.test.ts tests/frontend/use-index-diagnostics-health-summary.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

- Derive repair hints from live event patterns when backend diagnostics has not been refreshed yet.
