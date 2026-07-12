# Reference Refresh Content Plan Phase 94

## Goal

Continue reducing the reference refresh service's size and isolate the next
performance boundary for source-content IO and member-context loading.

## Context

Reference indexing still matters for large-project navigation and Find Usages.
The previous phase extracted affected-path planning. The remaining service-owned
helpers still mixed file IO, source filtering, and member-access detection into
`workspace_reference_index_service.rs`.

## Change

- Added `ReferenceRefreshContentPlan`.
- Added `plan_reference_refresh_content`.
- Moved source-file filtering, filesystem path normalization, content loading,
  and member-access detection into the refresh plan service.
- Reused the content plan from full refresh, incremental refresh, and profiling
  refresh paths.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_refresh_plan_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_receiver_tests`

## Next

Profile real projects to decide whether this boundary should gain a source
content cache, a byte budget, or a member-context fast path before more
reference-index behavior is added.
