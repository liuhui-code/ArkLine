# Index Repair Evidence UI Phase 171

## Goal

Make suggested index repair actions explainable in the diagnostics center, not
only visible as buttons or status-bar text.

## Context

Phase 170 projected stable repair actions from live query explain events into
effective diagnostics. The next usability gap was evidence: a user could see
`Rebuild Project Index`, but not why that action was suggested unless they
correlated it with Query Explain manually.

## Implementation

- Added `buildRepairActionEvidence` to the diagnostics model.
- Added a shared repair-action payload mapper so projection and diagnostics UI
  use the same stable action mapping.
- Reads only query events with stable `recommendedAction` payload values.
- Maps:
  - `rebuildIndex` -> `Rebuild Project Index`
  - `configureSdk` -> `Configure SDK`
- Shows the source query event and message under Health / Storage.
- Keeps repair buttons and existing Query Explain behavior unchanged.

## Guardrails

- Non-query events are ignored for repair evidence.
- Unsupported actions such as `wait`, `openFile`, and `reportBug` are not
  elevated to repair evidence.
- Evidence is capped to the newest three unique repair actions.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-model.test.ts tests/frontend/index-diagnostics-repair-actions.test.tsx tests/frontend/workspace-index-projection-store.test.ts`
- `pnpm check:line-count`
