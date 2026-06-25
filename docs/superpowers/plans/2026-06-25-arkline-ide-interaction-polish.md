# ArkLine IDE Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved IDE interaction polish spec: blame releases space, left navigation resizes, completion is line-aware, and Ctrl+F7 opens current-class methods.

**Architecture:** Keep orchestration in `AppShell`, editor-only mechanics in `ArkTsEditor`, pure parsing in a new method-symbol helper, and focused rendering in small layout components. Tests drive each slice before implementation.

**Tech Stack:** React 19, TypeScript, CodeMirror 6, Vitest/JSDOM, Tauri v2.

---

### Task 1: Git Blame Gutter Release

**Files:**
- Modify: `src/editor/ArkTsEditor.tsx`
- Test: `tests/frontend/editor.test.tsx`

- [ ] Add a failing editor test proving `.cm-git-trace-gutter` is absent when `gitBlameVisible={false}`.
- [ ] Run `pnpm test tests/frontend/editor.test.tsx`.
- [ ] Reconfigure `gitTraceCompartment` to `[]` when blame is hidden.
- [ ] Re-run `pnpm test tests/frontend/editor.test.tsx`.

### Task 2: Resizable Left Navigation

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/ShellSidebar.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] Add a failing AppShell test for dragging the left resize separator and keyboard resizing with clamp behavior.
- [ ] Run the focused test and confirm failure.
- [ ] Add `leftSidebarWidth` state, resize handlers, separator props, and CSS grid style wiring.
- [ ] Re-run the focused test.

### Task 3: Completion Line Suspension

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] Add a failing test: completion opens on one line, hides when caret moves to another line, and reappears after returning.
- [ ] Run the focused test and confirm failure.
- [ ] Track completion session origin and visibility separately from cached completion items.
- [ ] Clear suspended completion on Escape, accept, file change, incompatible prefix, and non-completion overlays.
- [ ] Re-run completion-focused tests.

### Task 4: Ctrl+F7 Methods Palette

**Files:**
- Create: `src/features/workspace/current-class-methods.ts`
- Create: `src/components/layout/CurrentClassMethodsPalette.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/shell-keymap.ts`
- Modify: `src/components/layout/app-shell-helpers.ts`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/current-class-methods.test.ts`
- Test: `tests/frontend/app-shell.test.tsx`
- Test: `tests/frontend/keybinding-model.test.ts`

- [ ] Add failing parser tests for ArkTS `struct` methods and exclusion of nested callback calls.
- [ ] Implement the parser.
- [ ] Add failing UI/keymap tests for Ctrl+F7 open, filter, Enter jump, and Alt+F7 compatibility.
- [ ] Implement the palette, command dispatch, and jump behavior.
- [ ] Re-run focused tests.

### Task 5: Verification

**Files:**
- No code changes unless tests expose a regression.

- [ ] Run `pnpm test tests/frontend/editor.test.tsx tests/frontend/app-shell.test.tsx tests/frontend/current-class-methods.test.ts tests/frontend/keybinding-model.test.ts`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Summarize changed files and any known limitations.
