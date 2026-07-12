# Search Controller Context Phase 64

## Goal

Centralize repeated current-search getters used by search action adapters.

## Scope

- Add `search-controller-context.ts`.
- Expose live getters for mode, query, root path, scope, and text options.
- Reuse the context in preview, next-page, and run-action adapters.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Context getters read current values when called; they do not cache state.
- Preview, next-page, and run actions continue to receive the same values as
  before.
- Controller has one explicit place describing current search state access.

## Follow-Up

If more action adapters need current search state, add getter access through this
context instead of creating more one-off closures in the controller.
