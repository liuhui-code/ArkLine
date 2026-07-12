# Index Rebuild Manager Queue Phase 116

## Goal

Route project-index rebuild repair through the index manager queue so
Diagnostics Center progress can be driven by real task statuses.

## Why This Phase

The schema repair UI could trigger `Rebuild Project Index`, but the backend
command still rebuilt synchronously through `WorkspaceIndexRuntime`. That path
cleared and rebuilt the index without producing manager task statuses, so the UI
could not reliably show queued/running/terminal progress after a repair click.

## Changes

- Added `workspace_index_rebuild_service`.
- Rebuild repair now clears the persistent/in-memory index first, then schedules
  a manager-backed `refresh-workspace` task.
- `rebuild_workspace_index` keeps the same command shape for the frontend, but
  now routes through the manager queue.
- Removed the old synchronous maintenance rebuild helper from the maintenance
  service.
- Added focused service coverage proving the repair path clears the cache and
  exposes a queued `refresh-workspace` status.

## Verification

- `cargo test workspace_index_rebuild_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_maintenance_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_tests --manifest-path src-tauri/Cargo.toml`

## Next Slice

Diagnostics should keep refreshing task statuses while a rebuild repair is
active, so the panel can follow queued -> running -> ready/failed without manual
refresh.
