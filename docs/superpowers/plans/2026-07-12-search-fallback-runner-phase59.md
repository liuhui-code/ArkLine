# Search Fallback Runner Phase 59

## Goal

Move fallback text search runtime wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-fallback-runner.ts` as the fallback search adapter.
- Preserve native text search usage for clean documents.
- Preserve frontend text search usage for dirty content and open-document reads.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Native text search still receives query, generation, cursor, and workspace root.
- Dirty searches still use the provided file reader instead of native search.
- Controller no longer imports the low-level fallback text search runner directly.

## Follow-Up

Future native search, frontend fallback, and dirty-document policy changes should
start in this adapter or the lower-level fallback module, not the controller.
