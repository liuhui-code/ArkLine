# Search Selection Movement Phase 40

## Goal

Move keyboard selection movement and auto-page trigger decisions out of `use-search-everywhere-controller.ts`.

## Scope

- Add a pure resolver for search selection movement.
- Preserve wrap-around movement.
- Preserve auto-loading the next page when moving past the last visible result.
- Preserve no-op behavior when no results are visible.
- Keep all code files under 500 lines.

## Verification

- Focused pagination session and controller tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract search result count and can-load-more derivation into a display/session helper.
- Continue shrinking the controller toward orchestration-only responsibilities.
