# Phase 157: Index Backoff Status Entry

## Goal

Surface retry/backoff health in the status bar once diagnostics evidence is
available.

## Why This Phase

Phase 156 moved retry backoff evidence into Health / Storage. Users still need
the top-level IDE chrome to show that the index is waiting to retry, instead of
only seeing a generic ready/partial status after a failure loop.

## Changes

- Added a pure status-bar health summary for retry backoff diagnostics.
- Routed `Index: Backoff` status-bar clicks directly to the diagnostics Health
  section.
- Connected loaded diagnostics evidence into the workspace index status summary.
- Covered the model and status-bar entry behavior with focused frontend tests.

## Verification

- `pnpm exec vitest run tests/frontend/app-shell-model.test.ts tests/frontend/shell-status-bar.test.tsx`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

The next slice should make retry/backoff evidence arrive without requiring the
diagnostics center to be opened first. Prefer a lightweight health projection or
unified-event watcher over adding broad polling in the shell.
