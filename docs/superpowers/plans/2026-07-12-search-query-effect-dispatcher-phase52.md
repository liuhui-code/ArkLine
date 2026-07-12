# Search Query Effect Dispatcher Phase 52

## Goal

Move active Search Everywhere query startup policy out of the React controller
effect.

## Scope

- Add a pure dispatcher for active overlay, workspace availability, and mode-based
  query startup.
- Preserve existing query generation behavior.
- Preserve missing-workspace clearing behavior.
- Keep entity and text execution delegated to their runner helpers.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Inactive overlays do not start a query.
- Active overlays still start a fresh query generation before dispatching.
- Missing workspace roots clear the trimmed query and do not run search.
- `searchEverywhere` mode dispatches entity search; `find` and `replace` dispatch
  text search.

## Follow-Up

The controller is now mostly UI actions, preview/read-file wiring, and result
surface adapters. The next phase should extract read/preview wiring or option
toggles, whichever provides the cleaner boundary without broad test churn.
