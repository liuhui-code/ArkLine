# Index Diagnostics Current File Section Extraction Phase 131

## Goal

Keep Index Diagnostics maintainable while preserving the current-file readiness evidence needed for large-project navigation and completion diagnosis.

## Changes

- Extracted Current File Readiness into `IndexDiagnosticsCurrentFileSection`.
- Extracted the shared metric tile into `IndexDiagnosticsMetric`.
- Preserved the existing section id, accessible region name, metric labels, fallback text, and readiness wording.
- Reduced `IndexDiagnosticsCenter.tsx` from the 470-line range to the 440-line range, restoring room for future diagnostics sections under the 500-line limit.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx`
- `pnpm check:line-count`

## Next Slice

- Split another stable Diagnostics Center section, preferably Processes / Queue or Health / Storage, before adding more UI evidence.
