# File Symbol Readiness Envelope Only Phase 179

## Goal

Remove the frontend legacy non-envelope file-symbol query path.

## Why

Ctrl+F12 file structure and indexed completion both depend on file-symbol data.
The old `queryWorkspaceFileSymbols` API returned only candidate arrays, so it
could not preserve readiness, cursor, or explain evidence. Keeping it exposed on
the frontend made it too easy to add new behavior outside the facade contract.

## Completed

- Removed `queryWorkspaceFileSymbols` from the frontend workspace API contract.
- Removed the runtime wrapper that invoked `query_workspace_file_symbols`.
- `useCurrentFileSymbolsController` now consumes only
  `queryWorkspaceFileSymbolsWithReadiness`; without it, the UI falls back to
  local file parsing.
- Migrated AppShell, completion, and current-file-symbol tests to readiness
  envelopes.

## Verification

- `rg -n "queryWorkspaceFileSymbols\\?|queryWorkspaceFileSymbols\\(" src tests/frontend`

## Next

Continue shrinking the frontend legacy query API by retiring non-envelope
workspace candidate fields after the remaining compatibility boundaries are
converted.
