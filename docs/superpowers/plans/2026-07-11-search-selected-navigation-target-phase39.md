# Search Selected Navigation Target Phase 39

## Goal

Move selected search target resolution out of `use-search-everywhere-controller.ts`.

## Scope

- Add a pure resolver for the selected Search Everywhere candidate or text-search result.
- Preserve Search Everywhere mode selecting candidates.
- Preserve Find/Replace modes selecting text matches.
- Return no target for out-of-range selections.
- Keep all code files under 500 lines.

## Verification

- Focused navigation action and controller tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract search selection movement and auto-page trigger logic.
- Keep selected target resolution independent so future result grouping does not bloat the controller again.
