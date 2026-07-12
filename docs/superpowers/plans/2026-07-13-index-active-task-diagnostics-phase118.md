# Index Active Task Diagnostics Phase 118

## Goal

Make an active project index rebuild visible immediately in the Index
Diagnostics Center instead of forcing the user to infer progress from the
Processes / Queue table.

## Why

Phase 117 keeps task evidence fresh after a diagnostics-triggered rebuild. The
next usability gap was visibility: users still need a clear, IDE-style status
strip near the diagnostics header that answers "is the rebuild actually doing
anything?"

## Changes

- Added an active project task summary model that ignores SDK tasks and terminal
  task states.
- Display the active project task near the Diagnostics Center header with kind,
  progress, duration, and detail text.
- Fixed task detail formatting so empty `message` fields do not hide the more
  useful task `reason`.
- Added focused model and component coverage for the active task summary.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-model.test.ts --testNamePattern "active project"`
- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx --testNamePattern "active project"`

## Next Slice

Use the same active task model in the status bar / health repair surface so
users see consistent wording before opening Diagnostics Center.
