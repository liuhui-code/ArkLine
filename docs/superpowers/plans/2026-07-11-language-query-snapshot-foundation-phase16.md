# Language Query Snapshot Foundation Phase 16

## Goal

Create one shared foreground language-query snapshot boundary before adding content budgets, timing telemetry, or worker-backed request preparation.

## Current State

- Code Actions and Find Usages both build `{ path, line, column, content }` inline or in feature-specific helpers.
- Future content policy would have to be duplicated across controllers.
- The existing language API still requires full content, so this phase keeps semantics unchanged.

## Plan

1. Add a shared `language-query-request-model`.
2. Move active document snapshot construction into the shared model.
3. Keep Code Actions source filtering/status logic in its feature model.
4. Update Find Usages and Code Actions to use the shared builder.
5. Add focused tests and run build/perf/line-count verification.

## Acceptance

- Active content is still read exactly once per request build.
- Request shape stays compatible with language query calls.
- Touched code files remain below 500 lines.
