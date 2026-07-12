# Index Diagnostics Evidence Section Extraction Phase 136

## Goal

Separate parser and unresolved-import evidence rendering from the diagnostics shell so future index failure diagnostics can evolve without growing `IndexDiagnosticsCenter`.

## Changes

- Added `IndexDiagnosticsEvidenceSections` with parser error and unresolved import sections.
- Preserved section ids, aria labels, counts, evidence keys, and empty states.
- Kept backend diagnostics data ownership in the center and moved only presentation details to focused components.
- Reduced the center further toward a stable composition layer.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx`
- `pnpm check:line-count`

## Next Step

Extract the remaining index layer readiness table if the diagnostics center needs another simplification pass.
