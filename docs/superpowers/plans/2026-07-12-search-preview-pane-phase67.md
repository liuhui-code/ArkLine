# Search Preview Pane Phase 67

## Goal

Separate file-preview rendering from `SearchEverywherePanel.tsx` so the query
panel can evolve toward cheaper result-list updates and preview-specific
optimization.

## Scope

- Extract `SearchPreviewPane` as a focused presentational component.
- Preserve full-content preview rendering when file content has loaded.
- Preserve compact context preview while file content is still loading.
- Keep mouse, keyboard, result selection, and navigation behavior unchanged.
- Keep all touched code files below 500 lines.

## Verification

- Add component tests for loaded and loading-preview states.
- Run focused query preview/controller tests.
- Run production build and runtime responsiveness guard before commit.

## Follow-up

This component boundary is the right place to add preview virtualization or
request cancellation if preview rendering becomes visible in latency traces.
