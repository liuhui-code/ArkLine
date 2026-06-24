# ArkLine Editor Interaction Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IDEA-style `Ctrl/Cmd+Click` hover feedback and typing-triggered completion while keeping ArkLine's current semantic worker and overlay architecture intact.

**Architecture:** Keep the semantic worker and Tauri language commands unchanged. Add a thin editor-interaction layer in the CodeMirror event extensions that surfaces definition-hover and typing-completion signals to `AppShell`, then reuse the existing completion overlay as the current presentation layer without locking the implementation to that UI forever.

**Tech Stack:** React 19, CodeMirror 6, Vitest, Testing Library, Tauri workspace API

---

### Task 1: Add editor interaction signals

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/editor/editor-events.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/editor/editor-extensions.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/editor/ArkTsEditor.tsx`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/editor.test.tsx`

- [ ] Add a failing editor test for modifier-hover feedback.
- [ ] Run `pnpm --dir /Users/liuhui/Documents/code/ArkLine exec vitest run tests/frontend/editor.test.tsx` and confirm the new hover test fails.
- [ ] Add a CodeMirror event callback for modifier-hover state and a second callback for doc-change completion triggers.
- [ ] Re-run `pnpm --dir /Users/liuhui/Documents/code/ArkLine exec vitest run tests/frontend/editor.test.tsx` and confirm the editor suite passes.

### Task 2: Wire AppShell auto completion and feedback

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/SearchOverlayContent.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/EditorSurface.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [ ] Add a failing AppShell test for typing-triggered completion that keeps the editor as the active typing surface.
- [ ] Run `pnpm --dir /Users/liuhui/Documents/code/ArkLine exec vitest run tests/frontend/app-shell.test.tsx` and confirm the new typing-completion test fails.
- [ ] Add `requestCompletion(trigger)` flow in `AppShell`, debounce typing-triggered requests, keep manual `Ctrl+Space`, and prevent the overlay input from stealing focus during auto-triggered completion.
- [ ] Add editor-root visual affordance classes for modifier-hover feedback and wire them through `EditorSurface`.
- [ ] Re-run `pnpm --dir /Users/liuhui/Documents/code/ArkLine exec vitest run tests/frontend/app-shell.test.tsx` and confirm the AppShell suite passes.

### Task 3: Focused verification and docs

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/docs/performance-baseline.md`
- Modify: `/Users/liuhui/Documents/code/ArkLine/gitlog.md`

- [ ] Run `pnpm --dir /Users/liuhui/Documents/code/ArkLine exec vitest run tests/frontend/editor.test.tsx`.
- [ ] Run `pnpm --dir /Users/liuhui/Documents/code/ArkLine exec vitest run tests/frontend/app-shell.test.tsx`.
- [ ] Update docs only if behavior or validation instructions changed materially.
