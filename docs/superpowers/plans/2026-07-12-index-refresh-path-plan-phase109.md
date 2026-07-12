# Index Refresh Path Plan Phase 109

## Goal

Keep the index runtime service focused on orchestration by separating incremental refresh path planning into a pure, tested service.

## Scope

- Extract previous/current/changed path comparison into `workspace_index_refresh_path_plan_service`.
- Normalize, sort, and dedupe added paths, removed paths, direct content paths, and dependency expansion seed paths in one place.
- Keep `workspace_index_service` responsible for applying the plan, dependency expansion, persistence, and content/fingerprint updates.
- Add focused tests for path normalization, filtering, sorting, deduplication, and empty previous-index behavior.

## Result

- `workspace_index_service.rs` dropped from 436 lines to 414 lines.
- All formerly 430+ line index-core files are now below 430 lines.
- Incremental refresh planning now has direct regression coverage.

## Verification

- `cargo test workspace_index_refresh_path_plan_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_service_tests --manifest-path src-tauri/Cargo.toml`
- `pnpm check:fast`

## Next Candidate

After this phase, the next architectural work should shift from file-size reduction to behavior-level index quality and responsiveness checks.
