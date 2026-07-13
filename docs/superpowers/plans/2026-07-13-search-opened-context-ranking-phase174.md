# Search Opened Context Ranking Phase 174

## Goal

Finish the search-quality ranking slice by making currently opened files a
first-class Search Everywhere ranking signal and tightening text-candidate
lexical ordering.

## Context

Mature IDE search does not rank by lexical score alone. Within the same result
group, active file, recent files, opened editors, and nearby project paths all
shape which result feels correct. ArkLine already had active, recent, and
project-proximity ranking. The missing explicit signal was the currently opened
editor set.

## Implementation

- Added `openedPaths` / `opened_paths` to `WorkspaceSearchRankingContext`.
- Passed opened editor tab paths from `AppShell` into Search Everywhere entity
  queries and next-page requests.
- Applied opened-path ranking after active and recent paths, before raw score.
- Kept the same ordering in frontend local fallback ranking.
- Tightened text candidate ranking so exact, prefix, contains, and camel/fuzzy
  matches are stable, with shorter text titles preferred when lexical strength
  is otherwise comparable.

## Guardrails

- Ranking context remains optional for compatibility callers.
- Opened-file priority is scoped within a source group; classes still outrank
  symbols, symbols still outrank files, and text remains a lower-priority
  Search Everywhere source.
- No large payloads are added to shell state; opened paths come from the existing
  tab store projection.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_search_ranking_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests`
- `pnpm exec vitest run tests/frontend/search-overlay-model.test.ts tests/frontend/search-entity-runner.test.ts tests/frontend/search-run-actions.test.ts tests/frontend/search-entity-query-session.test.ts tests/frontend/search-result-application.test.ts tests/frontend/use-search-everywhere-navigation.test.tsx tests/frontend/use-search-everywhere-pagination.test.tsx tests/frontend/workspace-index-query-api.test.ts`
