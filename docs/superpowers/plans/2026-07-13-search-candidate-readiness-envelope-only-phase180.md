# Search Candidate Readiness Envelope Only Phase 180

## Goal

Retire the remaining frontend public legacy indexed search candidate fields.

## Why

Search Everywhere and indexed completion are primary IDE paths. If the frontend
contract still exposes non-envelope `queryWorkspaceSearchEverywhere` or
`queryWorkspaceCandidates`, new UI code can accidentally bypass readiness,
explain evidence, pagination cursors, and partial/stale diagnostics.

## Completed

- Removed `queryWorkspaceSearchEverywhere` from the frontend workspace API
  contract and query API factory.
- Removed `queryWorkspaceCandidates` from the frontend workspace API contract
  and query API factory.
- Added frontend query API regression coverage proving legacy non-envelope
  fields are not exposed by the query API factory.
- Migrated the remaining AppShell completion test to
  `queryWorkspaceCandidatesWithReadiness`.
- Removed test-only legacy candidate spies from completion and Search
  Everywhere coverage.
- Migrated large-project core search, definition, usages, and completion
  regression coverage to facade readiness wrappers.
- Removed unused direct search/file-symbol readiness helpers from
  `workspace_index_query_service`.
- Renamed query-service tests so raw query-service checks and facade-envelope
  checks describe the correct architectural layer.
- Added backend command wrapper coverage for legacy Search Everywhere,
  workspace-candidate, and file-symbol commands so they stay facade-backed.
- Migrated ordinary Search Everywhere and SDK search regression tests from the
  direct legacy search helper to facade readiness wrappers.
- Split SDK Search Everywhere facade regression coverage into
  `workspace_sdk_search_facade_tests` so the SDK index test file stays well
  below the 500-line limit.
- Renamed the remaining interaction performance fixture helper to
  `query_workspace_search_everywhere_raw_baseline`, making its raw timing role
  explicit.
- Renamed backend command-service helpers so Search Everywhere item-array
  support is explicitly `compat`, while candidate and file-symbol envelope
  support is explicitly `facade`.
- Extracted workspace query Tauri commands into `commands/workspace_query.rs`,
  reducing `commands/workspace.rs` from the 497-line danger zone.
- Split workspace API indexing-action tests into
  `workspace-api-indexing-actions.test.ts`, reducing
  `workspace-api.test.ts` from the 500-line limit edge.
- Added frontend command-name regression coverage proving indexed candidate and
  file-symbol surfaces invoke only `_with_readiness` Tauri commands, not legacy
  item-array command names.
- Narrowed backend raw candidate, entity, file-symbol, and raw Search
  Everywhere baseline helpers to crate-only visibility. The remaining public
  query surface is the facade/readiness command layer plus explicit Tauri
  compatibility wrappers.
- Narrowed facade search subservice and candidate-page helpers to crate-only
  visibility. Search pagination and text fallback remain available to command
  wrappers, but public callers are funneled through `workspace_index_facade_service`.
- Narrowed facade navigation and completion subservice query functions to
  crate-only visibility. Definition, usages, and completion remain public
  through the readiness-envelope wrappers in `workspace_index_facade_service`.
- Narrowed facade envelope projection, event recording, explain construction,
  and readiness gate helpers to crate-only visibility. Command wrappers and
  facade subservices can still share them, but they are no longer presented as
  crate-external query APIs.
- Narrowed facade subservice module declarations in `services/mod.rs` to
  crate-only visibility. `workspace_index_facade_service` remains the public
  facade module; search/navigation/completion/envelope/event/explain/readiness
  helpers are internal implementation modules.
- Narrowed candidate-page module visibility and definition candidate helper
  function visibility to crate-only. Search/file-symbol pagination remains an
  internal facade implementation detail, and definition fallback resolution is
  available only through the index query/facade path.
- Narrowed entity-query module visibility to crate-only. File/class/symbol/API
  entity lookup remains available through query service and facade search, not
  as a crate-external service module.
- Narrowed text-candidate module and helper visibility to crate-only. Search
  Everywhere text-scope candidates remain reachable through query service and
  facade search, not as a crate-external helper module.
- Kept backend legacy Tauri commands as compatibility wrappers for now.

## Verification

- `rg -n "queryWorkspaceSearchEverywhere|queryWorkspaceCandidates\\b|queryWorkspaceCandidates\\?|queryWorkspaceCandidates\\(" src tests/frontend`
- `pnpm exec vitest run tests/frontend/workspace-index-query-api.test.ts`
- `pnpm exec vitest run tests/frontend/completion-candidate-provider.test.ts tests/frontend/workspace-index-query-api.test.ts`
- `pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "readiness-aware facade candidates|workspace indexed symbols"`
- `pnpm exec vitest run tests/frontend/workspace-api.test.ts tests/frontend/workspace-api-indexing-actions.test.ts tests/frontend/workspace-index-query-api.test.ts`
- `pnpm exec vitest run tests/frontend/workspace-index-query-api.test.ts`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_query_command_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_entity_query_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_candidate_page_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_text_search_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_completion_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_query_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_search_everywhere_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml sdk_switch_exposes_only_active_sdk_candidates`
- `cargo test --manifest-path src-tauri/Cargo.toml search_everywhere_includes_indexed_sdk_api_symbols`
- `cargo test --manifest-path src-tauri/Cargo.toml verifies_real_project_interaction_smoothness -- --ignored --nocapture`
- `pnpm check:line-count`
- `pnpm build`

## Next

Continue facade cleanup on backend-only compatibility paths. Remaining backend
legacy command names are registered only as Tauri compatibility wrappers; raw
interaction profiling is explicitly named as a baseline helper.
