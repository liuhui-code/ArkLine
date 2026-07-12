# Search Open Actions Phase 58

## Goal

Move search result opening action wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-open-actions.ts` as the navigation adapter for search results.
- Preserve direct text result, entity candidate, and selected-result opening.
- Keep navigation side effects delegated to the existing navigation action module.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Opening a text result still remembers the current location and closes the
  overlay before navigation.
- Opening an entity candidate still uses the candidate target.
- Opening the selected result reads the latest search session snapshot.
- Controller no longer owns selected-result session extraction for navigation.

## Follow-Up

Future click, Enter, and double-click navigation fixes should extend this adapter
or the lower-level navigation action, not the controller hook.
