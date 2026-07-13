# Index Copy Evidence Phase 173

## Goal

Add one-click collection of index diagnostics evidence so stalled or degraded
indexing can be reported without manual screenshot stitching.

## Context

The roadmap calls out one-click collection/export of index health evidence.
Diagnostics already expose health, queue, current-file readiness, layer
readiness, repair actions, and recent events. The missing piece was a compact
copyable report.

## Implementation

- Added `buildIndexDiagnosticsEvidenceReport`.
- The report includes:
  - workspace and active file
  - health counters
  - current-file readiness
  - queue pressure and visible task statuses
  - layer readiness
  - recent unified index events
- Added `Copy Evidence` to the Index Diagnostics Center header.
- Copy uses `navigator.clipboard.writeText` and reports copied/unavailable
  status inline.

## Guardrails

- The UI action only copies currently loaded diagnostics; it does not trigger
  new backend work.
- The report is plain text so it can be pasted into issues, chat, or logs.
- Large repeated arrays are capped in the report builder.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-model.test.ts tests/frontend/index-diagnostics-copy-evidence.test.tsx tests/frontend/index-diagnostics-center.test.tsx`
- `pnpm check:line-count`

