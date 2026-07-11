# Search Overlay Actions Phase 42

## Goal

Move search overlay reset and navigation-close side effects out of `use-search-everywhere-controller.ts`.

## Scope

- Add action helpers for reset/close behavior.
- Preserve reset order: invalidate search, record close latency, reset debounced query, clear selected preview state.
- Preserve navigation-close behavior: invalidate search, mark navigation close, hide overlay.
- Keep all code files under 500 lines.

## Verification

- Focused overlay action, controller, and navigation tests.
- Production build.
- Runtime latency gate.
- Line count and whitespace checks.

## Follow-Up

- Extract overlay query change/open actions next.
- Continue moving side-effect sequencing into independently tested action modules.
