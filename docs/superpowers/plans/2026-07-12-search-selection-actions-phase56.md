# Search Selection Actions Phase 56

## Goal

Move search result selection and load-more action wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-selection-actions.ts` as the selection action boundary.
- Preserve existing pagination decision logic through `resolveSearchSelectionMove`.
- Keep preview scheduling tied to successful selection changes.
- Keep load-more dispatch tied to selection movement past loaded results.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Direct selection patches the selected index and schedules preview.
- Arrow movement within loaded results updates selection and schedules preview.
- Arrow movement past the loaded boundary calls next-page loading with the target
  selected index.
- Controller no longer owns result-count and next-cursor selection policy.

## Follow-Up

Future keyboard and mouse selection polish should extend this module first, then
let the controller remain a thin adapter for UI callbacks.
