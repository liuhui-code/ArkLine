# Device Log Panel Model Phase 70

## Goal

Move high-volume log rendering calculations out of `DeviceHiLogPanel.tsx` so
the log view can keep improving throughput without mixing stream lifecycle,
query state, and virtual-window math in one component.

## Scope

- Extract rendered log window calculation for follow-tail and manual-scroll
  modes.
- Extract live-window status text formatting.
- Extract stats-polling error mapping.
- Preserve existing stream lifecycle, query worker, storage, filtering, and
  inspector behavior.
- Keep all touched code files below 500 lines.

## Verification

- Add focused model tests for tail rendering, scroll rendering, status text, and
  stats polling errors.
- Run existing Device Log UI and follow-tail tests.
- Run production build and runtime responsiveness guard before commit.

## Follow-up

Use this boundary for future log-throughput work: adaptive overscan, dynamic row
height measurement, and frame-budgeted render updates.
