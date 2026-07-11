# Search Pagination Session Phase 35

## Goal

Move text search page append behavior out of `use-search-everywhere-controller.ts` so the controller only schedules loading and applies a session patch.

## Scope

- Add a pure helper for text search pagination patches.
- Preserve current keyboard auto-load behavior.
- Preserve `nextCursor`, `textPageLoading`, selected index, and partial result notice behavior.
- Keep all code files under 500 lines.

## Verification

- Run focused pagination and controller tests.
- Run production build.
- Run runtime latency guard.
- Check line counts and whitespace.

## Follow-Up

- Continue reducing `use-search-everywhere-controller.ts` by moving overlay query lifecycle into a small runtime/session module.
- Keep pagination helpers pure so future worker-backed search can reuse the same result application model.
