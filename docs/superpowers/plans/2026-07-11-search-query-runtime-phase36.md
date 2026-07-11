# Search Query Runtime Phase 36

## Goal

Move query generation tracking, stale result suppression, and query finish handling into the search interaction runtime.

## Scope

- Add a runtime-level `runQuery` helper.
- Keep backend cancellation semantics unchanged.
- Keep text search fallback generation assignment lazy so native search receives the correct request generation.
- Keep pagination generation checks unchanged.
- Keep all code files under 500 lines.

## Verification

- Focused search runtime and controller tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract overlay debounce and clear behavior into a separate query lifecycle helper.
- Move search jump/open result behavior into a navigation action helper after controller size drops further.
