# Search Overlay Open Actions Phase 43

## Goal

Move Search Everywhere overlay open and query-change side effects out of `use-search-everywhere-controller.ts`.

## Scope

- Add action helpers for opening Search Everywhere, Find, and Replace overlays.
- Preserve Search Everywhere scope reset to `all`.
- Preserve normalized selected-text prefill for Search Everywhere and Find/Replace.
- Preserve query-change invalidation before updating the shared query.
- Keep all code files under 500 lines.

## Verification

- Focused overlay action, controller, navigation, and pagination tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract text-search miss reporting and query explain side effects.
- Continue reducing controller responsibility toward request orchestration only.
