# Search Controller Result Phase 41

## Goal

Move Search Everywhere controller return-surface assembly out of `use-search-everywhere-controller.ts`.

## Scope

- Add a small result builder for controller state, actions, and session compat fields.
- Preserve all existing public controller fields.
- Preserve lazy compat getters for session-backed fields.
- Reduce controller line count headroom below the 500-line limit.

## Verification

- Focused controller result and search controller tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract action bundle construction or split controller action groups to improve readability without regrowing the controller.
- Keep compat getters isolated until consumers fully switch to `searchSessionStore`.
