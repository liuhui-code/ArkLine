# Phase 151: Search Ranking Context UI Wiring

## Goal

Pass active-file and recent-file context from the Search Everywhere UI to the
backend indexed candidate facade.

## Why

Phase 149 added backend ranking context and Phase 150 exposed it through the
facade. Search Everywhere still called indexed queries without that context, so
large-project result pages could be truncated before active/recent/proximity
signals were applied. This phase closes the UI-to-backend loop.

## Changes

- Added a frontend `WorkspaceSearchRankingContext` API type.
- Extended indexed candidate query APIs with an optional ranking context.
- Passed `{ activePath, recentPaths }` from Search Everywhere first-page queries.
- Passed the same ranking context when loading additional entity result pages.
- Added serde support for the Rust `WorkspaceSearchRankingContext` command
  payload with camelCase fields.
- Kept old API call sites compatible through optional parameters and default
  backend context.

## Verification

- `pnpm exec vitest run tests/frontend/search-entity-runner.test.ts tests/frontend/search-run-actions.test.ts tests/frontend/search-next-page-loader.test.ts tests/frontend/search-next-page-action.test.ts tests/frontend/workspace-index-query-api.test.ts tests/frontend/use-search-everywhere-controller.test.tsx tests/frontend/use-search-everywhere-navigation.test.tsx tests/frontend/use-search-everywhere-pagination.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests`
- `pnpm check:line-count`
- `pnpm check:fast`
