# Symbol Resolution Lookup Phase 95

## Goal

Reduce the size and coupling of the symbol-resolution core before adding more
import/export binding optimizations.

## Context

`workspace_symbol_resolution_service.rs` was close to the 500-line source limit.
It mixed SQLite orchestration, import/export resolution flow, and pure lookup
helpers in one file. The lookup helpers are stable pure logic and can be tested
without a database.

## Change

- Added `workspace_symbol_resolution_lookup_service.rs`.
- Added focused tests for declaration lookup, export alias lookup, and import
  alias target selection.
- Moved binding lookup helpers out of `workspace_symbol_resolution_service.rs`.
- Kept existing symbol resolution flow and SQLite behavior unchanged.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_lookup_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_symbol_resolution_query_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests`

## Next

The next symbol-resolution slice should extract affected-path planning or
unresolved-symbol insertion so import/export-heavy optimization can happen
without pushing the orchestration service back toward the line limit.
