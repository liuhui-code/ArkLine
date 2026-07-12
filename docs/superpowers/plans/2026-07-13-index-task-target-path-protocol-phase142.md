# Index Task Target Path Protocol - Phase 142

## Goal

Prepare Index Diagnostics actions for precise task targeting without changing the backend journal schema in this phase.

## Implemented

- Added optional frontend task status fields:
  - `targetPaths`
  - `targetPathCount`
- Updated layer action state logic to use `targetPaths` when present.
- Kept conservative behavior when no target paths are available: active foreground navigation still disables `Index Current File`.
- Added coverage proving a foreground navigation task for another file does not disable current-file indexing.

## Deferred

- Backend live task status can later expose bounded changed-path samples from scheduler tasks.
- Persisted task journal remains unchanged to avoid schema churn for historical terminal statuses.

## Next

- Add backend live-only `targetPaths` projection from scheduler pending/running tasks.
- Use the same path-aware protocol for visible-file and completion indexing actions.
