# Phase 150: Search Ranking Context Facade

## Goal

Expose search-ranking context through the backend Search Everywhere facade.

## Why

Phase 149 added active-file, recent-file, and project-proximity ranking support in the backend ranking model. This phase connects that model to the Search Everywhere facade so future command/API/UI call sites can pass context without changing ranking internals.

## Changes

- Added `query_facade_search_everywhere_with_context`.
- Added `query_facade_search_everywhere_page_with_context`.
- Added `SearchEverywhereWithContext` facade request variant.
- Kept existing `SearchEverywhere` and command paths compatible with empty context.
- Added facade-level tests for active/recent path ordering and project-proximity tie breaking.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests`
- `pnpm check:line-count`
- `pnpm check:fast`
