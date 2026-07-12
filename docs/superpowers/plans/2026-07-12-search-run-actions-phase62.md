# Search Run Actions Phase 62

## Goal

Move entity and text search run-action dependency binding out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-run-actions.ts` as the query run-action adapter.
- Preserve the existing entity and text runner behavior.
- Keep current query, root path, scope, options, dirty state, tracking, patching,
  preview, and miss reporting bindings in one place.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Entity search still uses current workspace root, query, scope, recent paths, and
  readiness reporting.
- Text search still uses current mode, options, dirty state, fallback runner, and
  preview scheduling.
- Controller no longer directly owns entity/text runner dependency assembly.

## Follow-Up

Future query scheduling and worker-bound execution should start at this adapter,
then flow into the existing entity/text runners.
