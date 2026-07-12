# Phase 149: Search Ranking Context Foundation

## Goal

Add backend search-ranking support for active-file, recently-opened-file, and project-proximity signals.

## Why

IDE-grade Search Everywhere should not rank purely by lexical score. Mature IDEs also account for the user's current editing context: active file, recent files, and nearby project directories. The frontend overlay already has a local ordering model; the backend ranking service now has the same foundation for future facade/API adoption.

## Changes

- Added `WorkspaceSearchRankingContext` with `active_path` and `recent_paths`.
- Added `sort_search_everywhere_candidates_with_context`.
- Kept existing `sort_search_everywhere_candidates` as a compatibility wrapper with empty context.
- Normalized path separators and case before context matching.
- Added project-proximity tie breaking based on shared directory segments.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_search_ranking_service_tests`
- `pnpm check:line-count`
- `pnpm check:fast`
