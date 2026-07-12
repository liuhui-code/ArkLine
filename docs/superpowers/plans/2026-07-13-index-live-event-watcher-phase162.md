# Phase 162: Index Live Event Watcher

## Goal

Add the frontend live subscription path for backend unified index events.

## Why This Phase

Phase 161 let diagnostics refresh project backend `recentEvents` into the
frontend projection store. The next step toward IDE-style observability is a
watcher path so live backend events can update status surfaces without waiting
for a diagnostics refresh.

## Changes

- Added `WorkspaceIndexEventWatcher` and optional `watchWorkspaceIndexEvents`.
- The workspace management API listens for `workspace-index-event` and filters
  events by normalized workspace root.
- `useWorkspaceIndexWatchers` subscribes to live index events and records them
  into `workspaceIndexProjectionStore`.
- Projection store now supports bounded single-event merge with event-id
  dedupe, timestamp ordering, and retry-backoff health projection.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-index-event-api.test.ts tests/frontend/use-workspace-index-watchers.test.tsx tests/frontend/workspace-index-projection-store.test.ts`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

Emit `workspace-index-event` from the backend manager path when unified events
are written, starting with scheduler retry/backoff events.
