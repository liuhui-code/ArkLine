# Search Text Query Session Phase 30

## Goal

Move text-search query path planning out of `use-search-everywhere-controller`.

## Scope

- Add a pure text query planner for clear, indexed, and fallback paths.
- Keep existing indexed facade and fallback execution behavior unchanged.
- Reduce controller branching and prepare for moving text query execution next.
- Add focused planner tests.

## Non-goals

- Do not move async execution out of the controller yet.
- Do not change result rendering, preview loading, or backend commands.
- Do not change search query minimum length.

## Follow-up

Move text query execution and result patching into a dedicated session module.

## Verification

- Run text query planner and search controller tests.
- Run production build.
- Run runtime responsiveness guard.
- Keep all touched code files below 500 lines.
