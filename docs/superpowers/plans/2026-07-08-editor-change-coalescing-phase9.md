# Editor Change Coalescing Phase 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repeated full-document string copies while users type quickly, especially in medium and large files.

**Architecture:** Add a focused editor change dispatcher that stores the latest CodeMirror document and emits one `onChange(doc.toString())` per animation frame. CodeMirror remains immediately editable; React document state receives the coalesced final value.

**Tech Stack:** CodeMirror 6, TypeScript, Vitest.

---

### Task 1: Editor Change Dispatcher

**Files:**
- Create: `src/editor/editor-change-dispatcher.ts`
- Test: `tests/frontend/editor-change-dispatcher.test.ts`

- [ ] **Step 1: Add dispatcher tests**

Verify multiple queued documents emit only the latest value, flushing is explicit, and cancelling clears pending work.

- [ ] **Step 2: Implement dispatcher**

Expose `createEditorChangeDispatcher(onChange, scheduler)` with `queue`, `flush`, and `cancel`.

- [ ] **Step 3: Verify dispatcher**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/editor-change-dispatcher.test.ts
```

Expected: all tests pass.

### Task 2: CodeMirror Change Listener Integration

**Files:**
- Modify: `src/editor/editor-events.ts`
- Test: `tests/frontend/editor.test.tsx`

- [ ] **Step 1: Wire dispatcher into `createDocumentChangeListener`**

Replace direct `update.state.doc.toString()` with `dispatcher.queue(update.state.doc)`.

- [ ] **Step 2: Preserve editor behavior**

Run existing editor tests to ensure controlled updates, typing, selection, jump reveal, and git blame still work.

- [ ] **Step 3: Verify focused tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/editor-change-dispatcher.test.ts tests/frontend/editor.test.tsx tests/frontend/editor-selection-events.test.tsx
```

Expected: all tests pass.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2 plus this plan.

- [ ] **Step 1: File size check**

Run:

```bash
wc -l src/editor/editor-change-dispatcher.ts src/editor/editor-events.ts tests/frontend/editor-change-dispatcher.test.ts tests/frontend/editor.test.tsx
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
git add docs/superpowers/plans/2026-07-08-editor-change-coalescing-phase9.md src/editor/editor-change-dispatcher.ts src/editor/editor-events.ts tests/frontend/editor-change-dispatcher.test.ts
git commit -m "Coalesce editor change payloads"
```
