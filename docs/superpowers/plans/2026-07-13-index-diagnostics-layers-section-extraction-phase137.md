# Index Diagnostics Layers Section Extraction Phase 137

## Goal

Finish the diagnostics-center UI decomposition by moving index layer readiness table rendering into a focused component.

## Changes

- Added `IndexDiagnosticsLayersSection` for layer readiness table rendering.
- Preserved the `Index Layers` region id, aria label, columns, layer count, status badges, count formatting, recommended actions, reasons, and empty state.
- Removed row and status badge helpers from `IndexDiagnosticsCenter`.
- Reduced `IndexDiagnosticsCenter` to a composition shell responsible for modal layout, section navigation, and data aggregation.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx`
- `pnpm exec tsc --noEmit -p tsconfig.app.json`
- `pnpm check:line-count`

## Next Step

Use this component boundary to add richer layer-specific diagnostics without growing the center shell.
