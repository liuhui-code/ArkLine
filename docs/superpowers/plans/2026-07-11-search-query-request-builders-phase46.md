# Search Query Request Builders Phase 46

## Goal

Move entity and text query request construction out of `use-search-everywhere-controller.ts`.

## Scope

- Add entity query request builder for readiness/indexed/legacy/local source selection.
- Preserve readiness-first execution order.
- Preserve local fallback behavior.
- Add text query request builder for indexed/fallback runners.
- Preserve backend text query generation for cancellation and stale-result handling.
- Keep all code files under 500 lines.

## Verification

- Focused entity/text query session tests.
- Search controller and pagination tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract runEntitySearch/runTextSearch orchestration into a search request runner hook or module.
- Keep controller focused on wiring state, dependencies, and callbacks.
