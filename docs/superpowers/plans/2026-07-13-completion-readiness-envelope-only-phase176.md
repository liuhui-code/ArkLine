# Completion Readiness Envelope Only Phase 176

## Goal

Move indexed completion candidate collection away from legacy non-envelope
query APIs.

## Why

Completion diagnostics depend on readiness and explain evidence from the index
facade. The legacy `queryWorkspaceFileSymbols` and `queryWorkspaceCandidates`
paths return only item arrays, so they can silently bypass partial/stale
readiness and hide why completions are missing.

## Completed

- `completion-candidate-provider` now uses indexed completion candidates only
  from:
  - `queryWorkspaceFileSymbolsWithReadiness`
  - `queryWorkspaceCandidatesWithReadiness`
- If readiness APIs are unavailable, indexed candidates are treated as an empty
  envelope instead of falling back to legacy item-array calls.
- Semantic completion, keyword completion, and foreground completion indexing
  behavior stay unchanged.
- Added a regression test proving legacy indexed query APIs are not called.

## Verification

- `pnpm exec vitest run tests/frontend/completion-candidate-provider.test.ts`

## Next

Continue query facade cleanup by reducing Search Everywhere and app-shell tests
that still depend on legacy `queryWorkspaceSearchEverywhere` or
`queryWorkspaceCandidates` behavior.
