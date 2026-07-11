# Search Result Application Phase 45

## Goal

Move entity and text search result application decisions out of `use-search-everywhere-controller.ts`.

## Scope

- Add result application helpers for Search Everywhere entity results.
- Preserve entity result patching, truncation state, and miss reporting signal.
- Add result application helpers for text-search results.
- Preserve text result patching, truncation notice, preview scheduling signal, and miss reporting input.
- Keep actual side effects injected by the controller.
- Keep all code files under 500 lines.

## Verification

- Focused result application, search controller, pagination, navigation, and miss reporting tests.
- AppShell Search Everywhere and Find in Files explain tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract query request builders for entity/text search.
- Continue reducing controller responsibility toward starting requests and wiring callbacks.
