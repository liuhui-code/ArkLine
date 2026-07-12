# Services Module Extraction Phase 92

## Problem

`src-tauri/src/lib.rs` had grown to 498 lines because it owned the full
`services` module declaration list. That left almost no room for future module
registration while preserving the repository-wide 500-line limit.

Keeping the service module table in `lib.rs` also made unrelated service
additions look like application bootstrap changes.

## Goal

Move service module declarations to Rust's conventional
`src-tauri/src/services/mod.rs` without changing runtime behavior.

## Implementation

- Replaced the inline `mod services { ... }` block in `lib.rs` with
  `mod services;`.
- Added `src-tauri/src/services/mod.rs` containing the existing service and test
  module declarations.
- Preserved module visibility exactly as before.

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml smoke_test_runs
pnpm check:fast
```
