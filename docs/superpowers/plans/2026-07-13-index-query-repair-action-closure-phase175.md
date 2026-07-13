# Index Query Repair Action Closure Phase 175

## Goal

Make Query Explain recommendations actionable through the same diagnostics
repair language used by Health / Storage.

## Why

Index diagnostics already showed useful facts, but some backend recommendations
were only rendered as raw action ids or labels. Mature IDE diagnostics should
turn a query miss into a concrete next step when the action is safe and local.

## Completed

- Extended Query Explain action labels for:
  - `rebuildSdkIndex`
  - `indexCurrentFile`
  - `inspectParserFailures`
  - `inspectUnresolvedImports`
- Routed those actions in `IndexDiagnosticsCenter`.
- Extended query payload to repair action mapping so backend events can feed
  repair evidence consistently.
- Added focused frontend tests for labels, payload mapping, and UI routing.

## Verification

- `pnpm exec vitest run tests/frontend/workspace-query-explain-model.test.ts tests/frontend/workspace-index-repair-action-model.test.ts tests/frontend/index-diagnostics-query-actions.test.tsx tests/frontend/index-diagnostics-repair-actions.test.tsx`
- `pnpm check:line-count`
- `git diff --check HEAD --`

## Next

The next diagnostics slice should keep expanding the same action model instead
of adding one-off buttons. Good candidates are retry/backoff inspection and
direct failed-file drill-down.
