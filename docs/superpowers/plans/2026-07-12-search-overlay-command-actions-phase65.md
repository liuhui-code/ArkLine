# Search Overlay Command Actions Phase 65

## Goal

Move overlay command binding out of `use-search-everywhere-controller.ts`.

## Scope

- Add `search-overlay-command-actions.ts`.
- Preserve open, query-change, reset, and option toggle behavior.
- Keep low-level overlay behavior in `search-overlay-actions`.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Search Everywhere still opens with normalized selected editor text.
- Query changes still invalidate the current search session before updating the
  query.
- Reset still invalidates, clears the debounced query, and records UI latency.
- Case-sensitive and whole-word toggles still update only their own option.

## Follow-Up

Future overlay command additions should bind through this adapter instead of
adding more command wiring to the controller hook.
