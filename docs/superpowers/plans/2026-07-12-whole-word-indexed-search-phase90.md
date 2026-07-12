# Whole Word Indexed Search Phase 90

## Problem

Whole-word global text search was excluded from the TextIndex path. That forced
whole-word queries into filesystem fallback even when persisted content index
rows were ready.

On large projects, this is avoidable scanning work.

## Goal

Route non-regex whole-word search through the indexed content layer while keeping
whole-word boundary semantics correct.

## Implementation

- Content index search now filters candidate lines with the same word-boundary
  rule used by filesystem fallback.
- Whole-word filtering consumes a wider candidate window so embedded matches
  such as `indexBuilder` cannot take the result limit ahead of `Index`.
- Facade and compatibility query paths now allow non-regex whole-word requests to
  use TextIndex.
- Regression tests prove indexed whole-word search still works after the source
  file is unavailable, so the behavior cannot be satisfied by filesystem
  fallback.

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml workspace_content_index_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_query_service_tests
pnpm check:fast
```
