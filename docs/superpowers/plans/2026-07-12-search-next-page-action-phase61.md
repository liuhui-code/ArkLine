# Search Next Page Action Phase 61

## Goal

Move next-page action state gathering out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-next-page-action.ts` as the action adapter.
- Keep `search-next-page-loader.ts` responsible for pagination execution.
- Move current session, root path, query, scope, and generation lookup into the
  adapter.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Next-page loading still uses the latest search session snapshot.
- Entity pagination still uses the current query generation as the stale guard.
- Text pagination still receives dirty-document state and preview scheduling.
- Controller no longer owns next-page state assembly.

## Follow-Up

Future pagination behavior should start in the action adapter or loader, keeping
the controller limited to callback exposure.
