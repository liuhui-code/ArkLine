# Search Text Options State Phase 54

## Goal

Move text search option toggle rules out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-text-options-state.ts` as the option-state boundary.
- Preserve `caseSensitive` and `wholeWord` toggle behavior.
- Keep unrelated text search options unchanged when one option toggles.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Toggling case sensitivity only changes `caseSensitive`.
- Toggling whole word only changes `wholeWord`.
- Controller state updates remain React-owned, but option mutation rules are pure
  and independently tested.

## Follow-Up

If search options grow to include regex mode, include/exclude globs, file masks,
or scope presets, extend this state module first instead of adding more option
mutation logic to the controller.
