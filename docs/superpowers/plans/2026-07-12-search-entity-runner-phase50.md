# Search Entity Runner Phase 50

## Goal

Move Search Everywhere entity query orchestration out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-entity-runner.ts` as a narrow orchestration boundary.
- Keep readiness-first, indexed, legacy, and local fallback query order unchanged.
- Keep result application, miss reporting, and latency tracking delegated to the
  existing request runner.
- Keep controller focused on UI state wiring and action callbacks.
- Keep every code file under 500 lines.

## Behavior Guarantees

- No workspace root means no query is started.
- Readiness-capable backends remain preferred over indexed, legacy, and local
  fallback paths.
- Readiness envelopes still update shared query readiness.
- Search result patching and miss reports still flow through the existing
  request runner.

## Follow-Up

The next extraction should target text-search query orchestration, then the
remaining controller effect lifecycle.
