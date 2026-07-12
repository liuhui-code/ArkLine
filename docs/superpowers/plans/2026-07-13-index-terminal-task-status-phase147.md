# Phase 147: Frontend Terminal Index Task Statuses

## Goal

Keep frontend active-task diagnostics aligned with the backend index task lifecycle.

## Why

The backend projection treats `cancelled`, `superseded`, and `skipped` as terminal task statuses. The frontend active-task model only filtered `ready`, `partial`, `stale`, and `failed`, so completed replacement/cancellation states could still look like running work in Diagnostics Center repair actions or active task summaries.

## Changes

- Expanded the frontend `WorkspaceIndexTaskStatus` known status union with `cancelled`, `superseded`, and `skipped`.
- Centralized terminal task status recognition in the diagnostics model.
- Kept `stale` as a frontend compatibility terminal state.
- Added tests proving terminal project, SDK, and foreground-navigation tasks do not block active summaries or layer actions.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-model.test.ts`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`
- `pnpm check:line-count`
- `pnpm check:fast`
