# Facade Search Test Split Phase 91

## Problem

`workspace_index_facade_search_tests.rs` reached 491 lines after whole-word
indexed search coverage. That left almost no room for future search-scaling
tests while preserving the repository-wide 500-line file limit.

`src-tauri/src/lib.rs` is also close to the line limit, so adding a new test
module must keep module declarations compact.

## Goal

Split text-search-specific facade tests into their own module without changing
runtime behavior.

## Implementation

- Moved Text scope, global text search, whole-word TextIndex, and TextIndex
  fallback tests into `workspace_index_facade_text_search_tests.rs`.
- Kept Search Everywhere scope and layer explain tests in
  `workspace_index_facade_search_tests.rs`.
- Registered the new test module in `lib.rs` while preserving the 500-line cap.

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_text_search_tests
pnpm check:fast
```
