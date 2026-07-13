# Index Query Action Routing Phase 172

## Goal

Make Query Explain actions directly usable from the diagnostics center.

## Context

Previous phases surfaced query explain evidence, live repair actions, and repair
evidence. Users could see why a query failed, but still had to manually find the
right repair or diagnostics section.

## Implementation

- Preserved raw query explain `actionId` alongside the human-readable action
  label.
- Added stable button labels for supported query actions:
  - `waitForIndex` -> `Show Processes`
  - `inspectIndex` -> `Inspect Index`
  - `rebuildIndex` -> `Rebuild Project Index`
  - `configureSdk` -> `Configure SDK`
- Routed Query Explain actions from `IndexDiagnosticsCenter`:
  - rebuild triggers project index rebuild
  - configure opens SDK settings
  - wait scrolls to Processes / Queue
  - inspect scrolls to Health / Storage
- Kept non-actionable explain outcomes as evidence-only text.

## Guardrails

- Query Explain rendering stays presentation-only; side effects remain in the
  diagnostics center.
- Unsupported actions do not render buttons.
- Existing Query Explain evidence rows remain visible.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-query-explain-model.test.ts tests/frontend/index-diagnostics-query-actions.test.tsx tests/frontend/index-diagnostics-center.test.tsx`

