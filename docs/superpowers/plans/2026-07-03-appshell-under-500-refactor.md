# AppShell Under 500 Lines Refactor Plan

## Goal

Keep `src/components/layout/AppShell.tsx` below 500 lines without changing user-visible behavior.

Long-term direction:

- `AppShell.tsx` stays as a thin composition root.
- Workflow state and side effects live in focused hooks.
- Render-only structure lives in small components.
- Pure labels, status text, and filtering logic live in model/helper files.
- No new source file should exceed 500 lines.

## Baseline Problem

`AppShell.tsx` had accumulated too many responsibilities:

- workspace opening/session wiring
- project tree actions
- editor document/tab actions
- search, completion, usages, definition
- code actions and workspace edits
- settings and index diagnostics
- build, Git, blame, problems, terminal, status bar
- all overlay and tool-window rendering

This made every IDE feature change risky because unrelated UI, indexing, navigation, and persistence code shared one file.

## Target Shape

Current extracted boundaries:

- `AppShellMainLayout.tsx`: top bar, sidebar, editor/query surface.
- `AppShellOverlays.tsx`: blame card, completion popup, search overlays, settings/project dialogs, code action/workspace edit overlays.
- `AppShellToolWindows.tsx`: bottom tool window, definition miss banner, index diagnostics, status bar.
- `ProjectMutationDialog.tsx`: new file/folder dialog.
- `app-shell-constants.ts`: layout constants.
- `app-shell-model.ts`: pure AppShell status/model helpers.
- `app-shell-types.ts`: shared AppShell UI state types.

Controller hooks:

- `use-shell-layout-state.ts`
- `use-workspace-session.ts`
- `use-workspace-opening-controller.ts`
- `use-workspace-index-watchers.ts`
- `use-project-tree-actions.ts`
- `use-editor-documents.ts`
- `use-editor-navigation.ts`
- `use-editor-surface-controller.ts`
- `use-editor-tab-actions.ts`
- `use-active-document-actions.ts`
- `use-definition-controller.ts`
- `use-usages-controller.ts`
- `use-completion-controller.ts`
- `use-search-everywhere-controller.ts`
- `use-current-file-symbols-controller.ts`
- `use-code-actions-workspace-edit-controller.ts`
- `use-index-diagnostics-controller.ts`
- `use-settings-controller.ts`
- `use-build-controller-state.ts`
- `use-git-and-diff-controller.ts`
- `use-problems-controller.ts`
- `use-shell-transient-actions.ts`
- `use-workspace-reset-controller.ts`
- `use-app-shell-commands.ts`

## Completed Result

`AppShell.tsx` is now below the requested 500-line gate.

Line counts checked:

```text
494 src/components/layout/AppShell.tsx
484 src/components/layout/use-code-actions-workspace-edit-controller.ts
430 src/components/layout/use-search-everywhere-controller.ts
403 src/components/layout/use-completion-controller.ts
266 src/components/layout/AppShellToolWindows.tsx
228 src/components/layout/use-index-diagnostics-controller.ts
221 src/components/layout/use-build-controller-state.ts
169 src/components/layout/AppShellMainLayout.tsx
139 src/components/layout/use-app-shell-commands.ts
118 src/components/layout/AppShellOverlays.tsx
```

The final pass used compact wiring in `AppShell.tsx` to meet the line gate. That is acceptable as an intermediate state, but not the ideal final architecture.

Follow-up cleanup extracted pure derived UI state:

- `app-shell-derived-state.ts` now owns quick open results, recent result filtering, overlay labels, lazy tree decision, workspace/index status text, SDK status text, semantic capability, and partial-result notice priority.
- `AppShell.tsx` is now 469 lines.
- `tests/frontend/app-shell-model.test.ts` covers derived state and partial notice priority.

Follow-up surface split:

- `AppShellIndexAndStatusSurfaces.tsx` now owns the definition miss banner, index explain panel, index diagnostics center, and status bar.
- `AppShellToolWindows.tsx` is now focused on the bottom tool window and dropped from 266 lines to 122 lines.
- `AppShell.tsx` remains below the 500-line gate at 467 lines.

Overlay surface split:

- `AppShellSearchOverlaySurface.tsx` now owns the Search Everywhere / Find in Files / Command Palette overlay shell.
- `AppShellCodeActionSurfaces.tsx` now owns code actions and workspace edit preview rendering.
- `AppShellOverlays.tsx` is now 109 lines and acts as a small overlay aggregator.

Main layout split:

- `AppShellEditorWorkbench.tsx` now owns the editor query panel and editor surface composition.
- `AppShellMainLayout.tsx` now focuses on top bar, sidebar, and grid layout and dropped from 169 lines to 94 lines.
- Editor navigation, completion, definition, usage, save, and blame regression paths were verified after the split.

## Verification

Completed:

```bash
pnpm exec tsc --noEmit -p tsconfig.app.json
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t 'Open Project|launch workspace|recent project|reopens|Open Project failed|workspace edit|code action|Code Actions|opens completion|Git Trace|blame|saves through the workspace api'
pnpm exec vitest run tests/frontend/app-shell-model.test.ts
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t 'Open Project|recent project|workspace edit|code action|Code Actions|opens completion|Search Everywhere|Find in Files|reopens'
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t 'opens completion|auto-opens completion|definition|Find Usages|current file|Git Trace|blame|saves through the workspace api'
pnpm exec vitest run tests/frontend/use-definition-controller.test.tsx tests/frontend/use-usages-controller.test.tsx
git diff --check
```

Focused AppShell regression result:

- 30 passed
- 128 skipped by `-t` filter
- 1 test file passed

## Remaining Work

Next cleanup should improve readability without increasing file size:

1. Move long `AppShellMainLayout`, `AppShellOverlays`, and `AppShellToolWindows` prop builders into typed view-model hooks or builder helpers.
2. Keep each builder under 250 lines.
3. Avoid `any` bags; use `ComponentProps<typeof X>` or explicit local types.
4. Add a lightweight line-count guard for core source files if the project wants to enforce the 500-line rule automatically.
5. Split focused AppShell tests by workflow once feature churn slows down.

## Risk Controls

- Do not alter visual behavior during structural extraction.
- Do not rename user-facing text unless product behavior intentionally changes.
- Do not revert unrelated dirty worktree changes.
- If a controller hook approaches 500 lines, split by workflow before adding more behavior.
- Run focused AppShell tests plus TypeScript after every extraction phase.
