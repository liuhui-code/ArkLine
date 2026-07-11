# Search Miss Reporting Phase 44

## Goal

Move Search Everywhere and text-search miss reporting side effects out of `use-search-everywhere-controller.ts`.

## Scope

- Add a reporting helper for Search Everywhere entity misses.
- Preserve envelope explain priority before fallback explain queries.
- Preserve recent query explain recording for envelope explains.
- Add a reporting helper for text-search misses.
- Preserve suppress-miss behavior for indexed text search.
- Preserve stale request guards before updating status text.
- Keep all code files under 500 lines.

## Verification

- Focused miss reporting and search controller tests.
- AppShell Search Everywhere and Find in Files explain tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract search request apply handlers for entity/text results.
- Continue reducing controller responsibility toward query request orchestration only.
