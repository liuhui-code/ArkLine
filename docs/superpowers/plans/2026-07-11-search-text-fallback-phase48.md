# Search Text Fallback Phase 48

## Goal

Move fallback text-search execution and search file reading out of `use-search-everywhere-controller.ts`.

## Scope

- Add helper for search-file read precedence: active document, open document, backend file.
- Preserve preview mode behavior that can skip backend reads.
- Add helper for native text search vs frontend fallback search selection.
- Preserve native search generation/cursor/options.
- Preserve fallback search behavior that ignores unreadable files.
- Keep all code files under 500 lines.

## Verification

- Focused text fallback, controller, preview, pagination, navigation, request runner, and result application tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Reassess remaining controller responsibilities and remove any now-unused compatibility surface.
- Consider splitting request runner tests if they approach the 500-line limit.
