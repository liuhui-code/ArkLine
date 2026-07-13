# Legacy Search Command Facade Wrapper Phase 178

## Goal

Turn the old `query_workspace_search_everywhere` Tauri command into a facade
compatibility wrapper.

## Why

The frontend Search Everywhere path now uses readiness-envelope APIs. The old
command still returned plain item arrays, but it also reached the legacy query
service directly. That kept a parallel backend behavior path alive.

## Completed

- `query_workspace_search_everywhere_blocking` now calls
  `query_facade_search_everywhere_with_readiness_context`.
- The old command keeps its public `Vec<WorkspaceSearchCandidate>` return type
  by returning `envelope.items`.
- Added a Rust regression test proving the legacy command wrapper returns the
  same candidate ids as the readiness facade.
- Marked the legacy direct service helper as an explicit compatibility/testing
  helper.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_query_command_service_tests -- --nocapture`

## Next

Continue retiring legacy query API fields and direct service tests once their
callers have been migrated to readiness envelopes.
