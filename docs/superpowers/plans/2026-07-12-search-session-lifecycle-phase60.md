# Search Session Lifecycle Phase 60

## Goal

Move search session invalidation and navigation-close lifecycle wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-session-lifecycle.ts` as the lifecycle adapter.
- Preserve foreground invalidation and transient search state clearing.
- Preserve navigation close behavior through the existing overlay action.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Invalidation still advances the interaction runtime and clears preview/loading
  state.
- Navigation close still marks the close as navigation-handled, sets the overlay
  to `none`, and invalidates the active query.
- Controller no longer directly owns lifecycle mutation details.

## Follow-Up

If navigation close should stop cancelling active queries in the future, change
that policy explicitly in this lifecycle boundary and update tests there.
