# Search Workspace Runtime Phase 55

## Goal

Move workspace search cancellation wiring out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-workspace-runtime.ts` as the workspace-aware runtime factory.
- Preserve the existing interaction runtime behavior.
- Preserve backend cancellation through the current workspace root and API.
- Preserve silent cancellation failure handling.
- Keep every code file under 500 lines.

## Behavior Guarantees

- Starting a new query still cancels the previous active query.
- Cancellation uses the latest workspace root and workspace API.
- Missing workspace roots or missing cancel capability do not throw.
- Backend cancellation errors do not block the UI query path.

## Follow-Up

This boundary is ready for future queue/worker integration: the controller can
keep using the same runtime surface while cancellation moves deeper into the
background query scheduler.
