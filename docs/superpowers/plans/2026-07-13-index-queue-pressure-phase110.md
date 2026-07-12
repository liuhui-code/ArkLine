# Index Queue Pressure Phase 110

## Goal

Keep the index manager maintainable by moving queue-pressure projection into a
focused read-model service.

## Why This Phase

`workspace_index_manager_service.rs` was 498 lines and mixed scheduling entry
points, background worker lifecycle, status persistence, and queue-pressure
diagnostics. Queue pressure is pure projection logic and is used by status bar
and diagnostics paths, so it is a low-risk extraction that creates room for
future manager and worker lifecycle improvements.

## Changes

- Added `workspace_index_queue_pressure_service`.
- Added direct queue-pressure projection tests.
- Updated `WorkspaceIndexManagerRuntime::get_queue_pressure` to delegate to the
  projection service.
- Reduced `workspace_index_manager_service.rs` from 498 lines to 482 lines.

## Verification

- `cargo test workspace_index_queue_pressure_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_manager_priority_tests --manifest-path src-tauri/Cargo.toml`

## Next Slice

The next manager extraction should target background worker wake/idle lifecycle
or recent-status persistence, depending on which file is closest to the line
limit after the next feature change.
