# Search Miss Reporters Phase 57

## Goal

Move search miss reporting adapter wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-miss-reporters.ts` as the controller-facing reporting adapter.
- Preserve Search Everywhere and text search miss explanation behavior.
- Keep reporting fire-and-forget so diagnostics do not block the query hot path.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Entity miss reporting still records query explain evidence when available.
- Text miss reporting still respects suppression and current-query checks.
- Controller no longer binds `isCurrentQuery`, `explainIndexMiss`, and status
  reporting inline for every runner call.

## Follow-Up

Future index diagnostics and query explain work should extend the reporter
adapter first, keeping UI hooks free of diagnostic plumbing.
