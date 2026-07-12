# Index SDK Status Diagnostics Entry Phase 125

## Goal

Make SDK index status actionable from the status bar, matching the existing project index diagnostics entry.

## Changes

- Converted the SDK index status pill into a button when SDK index text is present.
- Reused the existing Diagnostics Center open handler.
- Added component coverage for clicking a stalled SDK index status.

## Verification

- `pnpm exec vitest run tests/frontend/shell-status-bar.test.tsx`

## Next Slice

- If diagnostics grows section navigation state, route SDK status clicks directly to Processes / Queue or Health / Storage.
