# Search Panel View Model Phase 66

## Goal

Keep query-panel rendering thin by moving derived presentation state out of
`SearchEverywherePanel.tsx`.

## Scope

- Add a pure `buildSearchEverywherePanelViewModel` model for:
  - regex mode detection
  - presentation labels
  - result count
  - selected text match
  - grouped text-search results
  - grouped Search Everywhere candidates
- Preserve existing keyboard, mouse, context-menu, preview, and navigation
  behavior.
- Keep all touched code files below 500 lines.

## Verification

- Add focused model tests for text search and Search Everywhere modes.
- Run focused query-panel/navigation tests.
- Run production build and runtime responsiveness guard before commit.

## Follow-up

Use this model boundary to support later result-list virtualization and cheaper
render updates without mixing performance policy into JSX.
