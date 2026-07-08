# Open File Fast Path Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid repeated backend file reads when navigation targets a document already loaded in the editor document store.

**Architecture:** Treat the document store as the safe in-memory file cache boundary. `openFile` first checks for an existing document record and activates the tab immediately; only missing documents call the workspace backend.

**Tech Stack:** React hooks, Vitest, existing document store and editor tab store.

---

### Task 1: Loaded Document Fast Path

**Files:**
- Modify: `src/components/layout/use-editor-surface-controller.ts`
- Test: `tests/frontend/use-editor-surface-controller.test.tsx`

- [ ] **Step 1: Add regression tests**

Verify that an already loaded document activates without calling `workspaceApi.openFile`, and that a cached closed document reopens as a tab without replacing in-memory content.

- [ ] **Step 2: Implement fast path**

Check `documentsRef.current.getDocument(path)` before starting a navigation transaction or reading from the backend.

- [ ] **Step 3: Share activation logic**

Move tab activation, transient editor reset, overlay close, and focus token bump into a local helper used by both cached and newly read documents.

- [ ] **Step 4: Verify focused tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/use-editor-surface-controller.test.tsx tests/frontend/use-editor-navigation.test.tsx tests/frontend/navigation-transaction-runtime.test.ts
```

Expected: all tests pass.

### Task 2: Release Checks

**Files:**
- Modify only files from Task 1 and this plan.

- [ ] **Step 1: File size check**

Run:

```bash
wc -l src/components/layout/use-editor-surface-controller.ts tests/frontend/use-editor-surface-controller.test.tsx docs/superpowers/plans/2026-07-08-open-file-fast-path-phase4.md
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
git add docs/superpowers/plans/2026-07-08-open-file-fast-path-phase4.md src/components/layout/use-editor-surface-controller.ts tests/frontend/use-editor-surface-controller.test.tsx
git commit -m "Skip backend reads for loaded documents"
```
