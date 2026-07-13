# Search Entity Readiness Envelope Only Phase 177

## Goal

Make Search Everywhere entity queries use readiness envelopes instead of legacy
non-envelope backend fallbacks.

## Why

Search Everywhere is a primary IDE interaction path. Legacy
`queryWorkspaceSearchEverywhere` and non-envelope `queryWorkspaceCandidates`
return item arrays without readiness, explain evidence, next cursors, or ranking
context. Keeping those paths in the entity query runner can hide partial/stale
index states and preserve parallel behavior.

## Completed

- Removed legacy indexed and mixed-query branches from the entity query session.
- `runSearchEntityQuery` now wires only:
  - `queryWorkspaceCandidatesWithReadiness`
  - local in-memory fallback candidates
- AppShell Search Everywhere tests now use readiness-envelope query mocks.
- Added runner coverage proving local fallback still works when readiness search
  is unavailable.

## Verification

- `pnpm exec vitest run tests/frontend/search-entity-query-session.test.ts tests/frontend/search-entity-runner.test.ts tests/frontend/search-run-actions.test.ts tests/frontend/use-search-everywhere-controller.test.tsx tests/frontend/use-search-everywhere-navigation.test.tsx`
- `pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Search Everywhere"`

## Next

Continue query facade cleanup by retiring public legacy frontend API fields once
remaining direct callers and compatibility tests have been migrated.
