# Index Layer Impact Reasons Phase 138

## Goal

Make layer readiness diagnostics explain why a missing or partial layer matters to the IDE user instead of only reporting raw status and counts.

## Changes

- Added `workspace_index_layer_reason_service` as a focused policy layer for readable layer reasons and recommended actions.
- Enriched layer readiness output without changing the SQLite schema or query behavior.
- Added explicit explanations for missing current-file evidence, missing workspace layers, partial layers, SDK API gaps, and parser/index failures.
- Kept `workspace_index_layer_readiness_service.rs` below the 500-line limit by moving reason policy to a dedicated service.
- Added backend coverage for user-visible impact reasons on project deep indexes and SDK API indexes.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_readiness_service_tests`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next Step

Use the richer reason/action data in the Diagnostics Center UI to show layer impact more clearly, such as grouping affected IDE features per layer.
