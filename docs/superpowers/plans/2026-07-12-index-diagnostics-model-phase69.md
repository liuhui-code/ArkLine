# Index Diagnostics Model Phase 69

## Goal

Move pure diagnostic summary formatting out of `IndexDiagnosticsCenter.tsx` so
the index observability UI can keep growing without turning the modal into one
large rendering and formatting component.

## Scope

- Extract header status summary construction.
- Extract DB-size formatting.
- Extract timeline count calculation.
- Extract task progress, duration, and stalled-detail formatting.
- Extract layer count and repair-action labels.
- Preserve existing Index Diagnostics Center UI and behavior.
- Keep all touched code files below 500 lines.

## Verification

- Add focused model tests for header, storage, timeline, task duration, and
  repair action formatting.
- Run existing Index Diagnostics Center rendering tests.
- Run production build and runtime responsiveness guard before commit.

## Follow-up

Use this model boundary to split the modal into smaller Processes, Health, and
Timeline section components without duplicating formatting logic.
