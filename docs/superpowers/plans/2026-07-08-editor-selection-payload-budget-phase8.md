# Editor Selection Payload Budget Phase 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid sending huge selected text payloads from CodeMirror into React state and completion/search controllers.

**Architecture:** Add a focused selection budget model. Selection change events still report caret line and column for all selections, but only include `selectedText` when the selection length is within budget.

**Tech Stack:** CodeMirror 6, TypeScript, Vitest.

---

### Task 1: Selection Payload Budget Model

**Files:**
- Create: `src/editor/editor-selection-budget.ts`
- Test: `tests/frontend/editor-selection-budget.test.ts`

- [ ] **Step 1: Add budget tests**

Verify small selections are readable and selections beyond the budget are omitted.

- [ ] **Step 2: Implement model**

Export `MAX_EDITOR_SELECTED_TEXT_LENGTH` and `readSelectedTextWithinBudget(doc, from, to)`.

- [ ] **Step 3: Verify model**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/editor-selection-budget.test.ts
```

Expected: all tests pass.

### Task 2: Selection Change Integration

**Files:**
- Modify: `src/editor/editor-events.ts`
- Test: `tests/frontend/editor-selection-events.test.tsx`

- [ ] **Step 1: Add integration tests**

Verify small selected text is forwarded and huge selected text is omitted while line/column still update.

- [ ] **Step 2: Use the budget model**

Replace direct `doc.sliceString(selectionFrom, selectionTo)` in `createSelectionChangeListener`.

- [ ] **Step 3: Verify focused tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/editor-selection-budget.test.ts tests/frontend/editor-selection-events.test.tsx tests/frontend/editor.test.tsx
```

Expected: all tests pass.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2 plus this plan.

- [ ] **Step 1: File size check**

Run:

```bash
wc -l src/editor/editor-selection-budget.ts src/editor/editor-events.ts tests/frontend/editor-selection-budget.test.ts tests/frontend/editor-selection-events.test.tsx tests/frontend/editor.test.tsx
```

Expected: every code file is under 500 lines.

- [ ] **Step 2: Build and performance gate**

Run:

```bash
pnpm build
pnpm perf:runtime
git diff --check
```

Expected: all commands pass.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-08-editor-selection-payload-budget-phase8.md src/editor/editor-selection-budget.ts src/editor/editor-events.ts tests/frontend/editor-selection-budget.test.ts tests/frontend/editor-selection-events.test.tsx
git commit -m "Cap editor selected text payloads"
```
