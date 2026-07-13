# Editor Large File Budget Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce CodeMirror initialization and decoration cost for large files while preserving core editing, search, selection, and explicit jump behavior.

**Architecture:** Move the large-file threshold into a focused editor budget model and make editor extensions honor that budget. Large files keep core editing extensions but skip language parsing, folding, hover decorations, typing completion triggers, and full-file git blame gutter.

**Tech Stack:** CodeMirror 6, React, Vitest.

---

### Task 1: Editor Document Budget Model

**Files:**
- Create: `src/editor/editor-document-budget.ts`
- Test: `tests/frontend/editor-document-budget.test.ts`

- [x] **Step 1: Add threshold tests**

Verify small files are normal mode and files at or above the threshold enter large-document mode.

- [x] **Step 2: Implement model**

Export `LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD` and `isLargeEditorDocument(value)`.

- [x] **Step 3: Verify model**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/editor-document-budget.test.ts
```

Expected: all tests pass.

### Task 2: Large Editor Extension Budget

**Files:**
- Modify: `src/editor/ArkTsEditor.tsx`
- Modify: `src/editor/editor-extensions.ts`
- Test: `tests/frontend/editor.test.tsx`

- [x] **Step 1: Add large-file behavior tests**

Verify large files do not enable modifier-hover decorations and do not mount git blame gutter, while normal files retain existing behavior.

- [x] **Step 2: Wire budget model**

Use `isLargeEditorDocument(value)` inside `ArkTsEditor`.

- [x] **Step 3: Trim large-file extensions**

In `createEditorExtensions`, skip hover decoration field, hover handler, typing completion listener, fold keymap, and git trace gutter when `largeDocumentMode` is true.

- [x] **Step 4: Verify focused tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/editor-document-budget.test.ts tests/frontend/editor.test.tsx
```

Expected: all tests pass.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2 plus this plan.

- [x] **Step 1: File size check**

Run:

```bash
wc -l src/editor/editor-document-budget.ts src/editor/ArkTsEditor.tsx src/editor/editor-extensions.ts tests/frontend/editor-document-budget.test.ts tests/frontend/editor.test.tsx
```

Expected: every code file is under 500 lines.

- [x] **Step 2: Build and performance gate**

Run:

```bash
pnpm build
pnpm perf:runtime
git diff --check
```

Expected: all commands pass.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-08-editor-large-file-budget-phase7.md src/editor/editor-document-budget.ts src/editor/ArkTsEditor.tsx src/editor/editor-extensions.ts tests/frontend/editor-document-budget.test.ts tests/frontend/editor.test.tsx
git commit -m "Reduce editor work for large files"
```

## Completion Notes

- Implemented `editor-document-budget` and large-document mode wiring in `ArkTsEditor`.
- Large files now skip nonessential editor work including modifier-hover decorations, full-file git blame gutter, parser/folding/hover/typing completion extensions.
- Verified focused editor suite:

```bash
pnpm test -- --run tests/frontend/editor-document-budget.test.ts tests/frontend/editor-large-document.test.tsx tests/frontend/editor-selection-budget.test.ts tests/frontend/editor-selection-events.test.tsx tests/frontend/editor.test.tsx
```

- Code files in this phase remain under 500 lines.
- Commit intentionally remains pending until explicitly requested.
