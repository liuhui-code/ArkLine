# Symbol Resolution Unresolved Writer Phase 97

## Goal

Move unresolved-symbol persistence out of the symbol-resolution orchestration
service so future insert batching can evolve behind a small writer boundary.

## Context

Unresolved import/export facts are important for diagnostics, repair actions,
and query explain. The write path lived inline in
`workspace_symbol_resolution_service.rs`, which made the service larger and
would make prepared-statement or batched insert work harder to isolate.

## Change

- Added `workspace_symbol_resolution_unresolved_service.rs`.
- Added a focused test proving unresolved rows persist reason, source position,
  and generation.
- Replaced the local `insert_unresolved_symbol` helper with the writer service.
- Kept existing unresolved import/export behavior unchanged.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_unresolved_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_query_service_tests`

## Next

If profiling shows unresolved rows or alias writes are hot in import-heavy
projects, this writer can grow a reusable prepared-statement inserter without
touching the main symbol-resolution orchestration flow.
