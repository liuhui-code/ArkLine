# Search Request Runner Phase 47

## Goal

Move entity and text search request orchestration out of `use-search-everywhere-controller.ts`.

## Scope

- Add request runner helpers for Search Everywhere entity search and text search.
- Preserve short-query clearing without constructing backend requests.
- Preserve runtime `trackQuery` generation and stale-result behavior.
- Preserve UI latency recording.
- Preserve session patching, preview scheduling, and miss reporting wiring.
- Keep all code files under 500 lines.

## Verification

- Focused search request runner tests.
- Search controller, pagination, navigation, query session, result application, and miss reporting tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract the remaining fallback text-search file reading path.
- Reassess whether `use-search-everywhere-controller.ts` has reached orchestration-only responsibility.
