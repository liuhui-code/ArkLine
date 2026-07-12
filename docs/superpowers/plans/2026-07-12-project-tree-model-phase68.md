# Project Tree Model Phase 68

## Goal

Move project-tree construction and traversal out of `ProjectToolWindow.tsx` so
large-project UI work can evolve behind a pure, testable model boundary.

## Scope

- Extract flat workspace tree construction.
- Extract lazy tree hydration with loading rows.
- Extract visible entry construction.
- Extract directory and active-file ancestor collection.
- Preserve existing common-root compression and current project tree behavior.
- Keep all touched code files below 500 lines.

## Verification

- Add model tests for flat entries, lazy loading rows, and active-file ancestors.
- Run focused project tree component and hook tests.
- Run production build and runtime responsiveness guard before commit.

## Follow-up

The next project-tree performance slice should use this boundary for visible-row
windowing and cheaper expansion updates on very large workspaces.
