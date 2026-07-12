# Index Layer Status Service Phase 100

## Goal

Move pure layer status mapping out of `workspace_index_layer_readiness_service.rs` so readiness reporting can keep evolving without hitting the 500-line ceiling.

## Why

Layer readiness is on the user-visible path for navigation, completion, search, and diagnostics. The service was 494 lines and mixed SQL projection with status classification. Extracting the pure status helpers makes future readiness and diagnostics changes safer.

## Scope

- Add `workspace_index_layer_status_service.rs`.
- Move count, text, failure, and file-hot status mapping into the helper.
- Add focused tests for missing/partial/ready aggregation, failure precedence, text status mapping, and current-file hot readiness.
- Keep SQL readiness projections unchanged.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_status_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_readiness_service_tests`
- `pnpm check:fast`
