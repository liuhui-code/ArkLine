# Search Text Query Execution Phase 31

## Goal

Move text-search execution branching out of `use-search-everywhere-controller`.

## Scope

- Extend the text query session with an executor.
- Encapsulate indexed facade execution, indexed-missing fallback, and miss-explain suppression.
- Keep result patching and UI interactions in the controller.
- Add focused executor tests.

## Non-goals

- Do not move controller state patching yet.
- Do not change backend search commands or result shape.
- Do not change Search Everywhere UI behavior.

## Follow-up

Move text result patching and miss explain handling into a controller-adjacent text session module.

## Verification

- Run text query session and search controller tests.
- Run production build.
- Run runtime responsiveness guard.
- Keep all touched code files below 500 lines.
