# Index Diagnostics Model Split Phase 113

## Goal

Move index diagnostics models out of `workspace.rs` so future diagnostics,
schema-policy, and repair-flow work can keep evolving without hitting the
500-line file limit.

## Why This Phase

`workspace.rs` reached 495 lines after adding schema-version policy diagnostics.
That left almost no room for future index observability fields. Diagnostics
models are cohesive and already form their own API surface, so splitting them is
a low-risk structural improvement.

## Changes

- Added `models::workspace_index_diagnostics`.
- Moved diagnostics/event/timeline/queue-pressure/parser-failure/unresolved
  import models into that module.
- Kept re-exports from `models::workspace` so existing commands and services do
  not need a broad import migration.
- Added a serialization contract test for camelCase diagnostics fields.
- Reduced `workspace.rs` from 495 lines to 397 lines.

## Verification

- `cargo test workspace_index_diagnostics_models_serialize_with_camel_case_contract --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_diagnostics_service_tests --manifest-path src-tauri/Cargo.toml`
- `pnpm check:fast`

## Next Slice

The next model-maintenance slice should split remaining index query/readiness
models from `workspace.rs` only when new fields are needed. Avoid moving models
without an immediate pressure or ownership reason.
