# Search Text Result Application Phase 32

## Goal

Move text-search result patch rules out of `use-search-everywhere-controller`.

## Scope

- Add pure helpers for result patch construction and miss-explain eligibility.
- Keep UI side effects in the controller.
- Keep preview scheduling behavior unchanged.
- Add focused helper tests.

## Non-goals

- Do not move miss explain async calls yet.
- Do not change text search result rendering or pagination behavior.
- Do not change backend search commands.

## Follow-up

Extract entity query planning/execution from the search controller.

## Verification

- Run search helper and controller tests.
- Run production build.
- Run runtime responsiveness guard.
- Keep all touched code files below 500 lines.
