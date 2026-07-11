# Search Overlay Query Lifecycle Phase 37

## Goal

Move search overlay query debounce and inactive-overlay synchronization out of `use-search-everywhere-controller.ts`.

## Scope

- Add `useSearchOverlayDebouncedQuery` for active overlay debounce.
- Preserve immediate sync when the search overlay is closed.
- Preserve the navigation-close skip path so result navigation does not double-invalidate search state.
- Guard inactive overlay synchronization from duplicate React effect execution.
- Keep all code files under 500 lines.

## Verification

- Focused lifecycle, controller, and navigation tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract search result navigation actions from the controller.
- Continue moving search UI lifecycle into small hook modules until the controller owns only orchestration.
