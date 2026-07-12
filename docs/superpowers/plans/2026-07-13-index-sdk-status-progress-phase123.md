# Index SDK Status Progress Phase 123

## Goal

Make SDK indexing progress visible in the status bar so users can distinguish an active SDK index job from a stalled or opaque `running` state.

## Changes

- Added a regression test for SDK status text with progress.
- Reused the diagnostics SDK task summary formatter in the app shell model.
- Preserved the ready-state symbol count text for completed SDK indexing.

## Verification

- `pnpm exec vitest run tests/frontend/app-shell-model.test.ts --testNamePattern "formats index"`
- `pnpm build`

## Next Slice

- Consider a stalled SDK status summary in the status bar if SDK tasks can heartbeat independently from project tasks.
- Keep routing richer queue/process detail to Diagnostics Center instead of overloading the status bar.
