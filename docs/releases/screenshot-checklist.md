# ArkLine Screenshot Checklist

Use this checklist before publishing the first public screenshot set.

## Capture goals

The screenshots should prove that ArkLine already has:

- an IDEA-like shell hierarchy
- a real project tree
- a readable editor surface
- bottom Git and Terminal surfaces
- query overlays and keyboard-driven flows

## Required screenshots

1. Main shell with a real ArkTS project open
2. Project tree + active editor tab + status bar
3. Search Everywhere overlay
4. Quick Open overlay
5. Git diff tool window with changed file list and diff content
6. Terminal tool window with validation action output
7. Go to Definition or completion flow in context

## Capture rules

- use a real ArkTS sample workspace, not the empty welcome state
- prefer a window size close to a normal laptop development setup
- keep the shell in the approved IDEA-like visual mode
- avoid placeholder demo text when a real file can be shown
- keep the project tree expanded enough to look credible but not noisy
- ensure status bar text is visible and not clipped
- avoid screenshots with duplicate buttons, stale dialogs, or half-open overlays

## Suggested output paths

- `docs/assets/arkline-main-shell.png`
- `docs/assets/arkline-search-everywhere.png`
- `docs/assets/arkline-quick-open.png`
- `docs/assets/arkline-git-diff.png`
- `docs/assets/arkline-terminal.png`
- `docs/assets/arkline-definition-flow.png`

## README integration order

Once screenshots exist, update the README in this order:

1. add a hero screenshot near the top
2. add a compact screenshot strip or bullet-linked image section
3. keep text concise once images can carry the visual proof
