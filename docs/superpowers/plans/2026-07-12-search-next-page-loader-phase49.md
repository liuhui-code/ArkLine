# Search Next Page Loader Phase 49

## Goal

Move Search Everywhere and text-search next-page loading out of
`use-search-everywhere-controller.ts` while preserving pagination behavior.

## Scope

- Add a shared next-page loader for entity and text search modes.
- Keep controller ownership limited to runtime state wiring and UI actions.
- Preserve loading guards, stale-query guards, cursor handoff, append patches, and
  preview scheduling.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Entity pagination sets `textPageLoading` before the backend request.
- Stale entity responses do not append results.
- Text pagination passes dirty state, generation, and cursor into fallback search.
- Text pagination schedules preview only when a caller requests a selected index.
- Missing root path, missing cursor, or active loading state remains a no-op.

## Follow-Up

Next controller reductions should target remaining request orchestration seams:

- Search query planning and execution lifecycle.
- Overlay open and close side effects that still depend on workspace state.
- Navigation result application and status reporting.
