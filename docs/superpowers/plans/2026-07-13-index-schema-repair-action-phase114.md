# Index Schema Repair Action Phase 114

## Goal

Connect schema-version policy results to health and diagnostics repair actions.

## Why This Phase

Phase 112 exposed `schema_version_actions`, but the repair action layer did not
consume it. A workspace with an incompatible persisted index schema could show
`needs-rebuild` in diagnostics without offering the user a clear
`rebuildProjectIndex` action.

## Changes

- Preserved persisted schema domain versions instead of overwriting them during
  schema ensure.
- Added `schema_needs_rebuild` to the repair action input model.
- Made health and diagnostics add `rebuildProjectIndex` when any schema domain
  reports `needs-rebuild`.
- Added focused tests for schema version preservation, health repair actions,
  and diagnostics repair actions.
- Split schema diagnostics tests into a dedicated module to keep files under
  the 500-line maintenance limit.

## Verification

- `cargo test workspace_index_schema_version_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_health_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_diagnostics_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_diagnostics_schema_service_tests --manifest-path src-tauri/Cargo.toml`

## Next Slice

The next schema slice should make the rebuild action more actionable in the UI:
show which schema domains require rebuild and route the repair button to the
existing project-index rebuild path with progress feedback.
