# Search Preview Session Phase 29

## Goal

Move selected-result preview scheduling out of `use-search-everywhere-controller`.

## Scope

- Create a small framework-independent search preview session helper.
- Keep preview debounce, generation checks, and stale preview clearing unchanged.
- Reduce the main search controller line count and responsibility.
- Add focused preview session tests.

## Non-goals

- Do not split entity/text query execution yet.
- Do not change preview payload size or backend preview reads.
- Do not change Search Everywhere UI.

## Follow-up

Split text query execution into a dedicated search session module, then move entity query execution.

## Verification

- Run search preview/session tests.
- Run production build.
- Run runtime responsiveness guard.
- Keep all touched code files below 500 lines.
