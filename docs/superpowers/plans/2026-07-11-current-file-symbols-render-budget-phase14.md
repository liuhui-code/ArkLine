# Current File Symbols Render Budget Phase 14

## Goal

Keep normal editor rendering responsive by moving current-file symbol parsing out of the closed-state render path.

## Current Hot Path

- `useCurrentFileSymbolsController` computes local class methods during render.
- That computation calls `getActiveContent()` even when the Ctrl+F12/File Structure popup is closed.
- `collectCurrentClassMethods` splits the full document into a line array.

## Plan

1. Gate local method parsing behind `currentMethodsVisible`.
2. Add a regression test proving closed File Structure does not read active content.
3. Rewrite `collectCurrentClassMethods` to use the shared line scanner.
4. Preserve current matching behavior for methods, members, nested classes, and caret scoping.
5. Run focused tests, runtime perf, build, line-count checks, and commit.

## Acceptance

- Closed File Structure no longer touches active document content.
- Current class method tests keep passing.
- All touched code files remain below 500 lines.
