# Phase 153: Reference Refresh Budget Evidence

## Goal

Surface reference-refresh content budget skips in deep-layer performance
evidence.

## Why

Phase 152 added bounded source-content loading for reference refresh. That keeps
large projects responsive, but profile output also needs to explain when
reference indexing skipped oversized content. Otherwise a real-project profile
could look healthy while hiding degraded reference coverage.

## Changes

- Added optional `detail` text to `WorkspaceIndexStageSample`.
- Appended sample details to performance evidence lines.
- Added `samples_from_reference_refresh_profile` to convert reference refresh
  profile details into performance samples.
- Included `skippedContent` and member-context loading state in reference
  refresh performance evidence.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_performance_gate_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_diagnostics_service_tests::reports_deep_layer_performance_gate_events_in_timeline`
- `pnpm check:line-count`
- `pnpm check:fast`
