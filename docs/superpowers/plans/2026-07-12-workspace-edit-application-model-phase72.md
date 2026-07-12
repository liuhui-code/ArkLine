# Workspace Edit Application Model Phase 72

## Goal

Move workspace-visible-file and index-delta calculations out of the code actions
controller so applying workspace edits is easier to reason about and test.

## Scope

- Extract visible file updates after create, rename, delete, and text
  operations.
- Extract index added/removed path calculation.
- Preserve directory rename/delete behavior for all visible descendant files.
- Preserve workspace tree regeneration through `createFileTreeNodes`.
- Keep workspace edit preview, apply lifecycle, tab refresh, and status behavior
  unchanged.
- Keep all touched code files below 500 lines.

## Verification

- Add model tests for directory rename, directory delete, and text edit deltas.
- Run focused code action and workspace edit tests.
- Run production build and runtime responsiveness guard before commit.

## Follow-up

Continue shrinking `use-code-actions-workspace-edit-controller.ts` by extracting
tab-refresh handling and resolve-result application into action modules.
