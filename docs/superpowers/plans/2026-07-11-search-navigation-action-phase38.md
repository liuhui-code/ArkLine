# Search Navigation Action Phase 38

## Goal

Move search result navigation side effects out of `use-search-everywhere-controller.ts`.

## Scope

- Add pure action helpers for text-result and candidate navigation.
- Preserve side-effect order: remember current location, close search overlay, navigate, record jump latency.
- Preserve candidate defaults for missing line and column.
- Ignore candidates without paths.
- Keep all code files under 500 lines.

## Verification

- Focused navigation action and controller tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract selected-result resolution into a small helper so the controller no longer branches over text results vs entity candidates.
- Continue keeping navigation behavior covered independently from the UI hook.
