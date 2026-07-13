# Document Dirty State Budget Phase 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid allocating and scanning every document when search needs to know whether any open document is dirty.

**Architecture:** Maintain a dirty document count inside the document store. Writes still update each document record synchronously, while `hasDirtyDocuments()` returns `dirtyCount > 0`.

**Tech Stack:** TypeScript, React hooks, Vitest.

---

### Task 1: Store Dirty Count

**Files:**
- Modify: `src/features/documents/document-store.ts`
- Test: `tests/frontend/document-store.test.ts`

- [x] **Step 1: Add dirty count tests**

Verify `hasDirtyDocuments()` tracks dirty, saved, external clean updates, and reopening a path.

- [x] **Step 2: Implement dirty count**

Track dirty transitions through a helper so `updateDocument`, `saveDocument`, `applyExternalChange`, and `openDocument` keep count correct.

- [x] **Step 3: Verify store tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/document-store.test.ts
```

Expected: all tests pass.

### Task 2: Search Dirty Fast Path

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

- [x] **Step 1: Use O(1) query**

Replace `documentsRef.current.getDocuments().some((document) => document.isDirty)` with `documentsRef.current.hasDirtyDocuments()`.

- [x] **Step 2: Verify focused search tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/document-store.test.ts tests/frontend/use-search-everywhere-controller.test.tsx tests/frontend/use-search-everywhere-pagination.test.tsx
```

Expected: all tests pass.

Actual: `tests/frontend/document-store.test.ts`, `tests/frontend/use-search-everywhere-controller.test.tsx`, and `tests/frontend/use-search-everywhere-pagination.test.tsx` passed.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2 plus this plan.

- [x] **Step 1: File size check**

Run:

```bash
wc -l src/features/documents/document-store.ts tests/frontend/document-store.test.ts src/components/layout/AppShell.tsx
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

Actual: focused document/search tests passed, `src/components/layout/AppShell.tsx` is 463 lines, all listed files are under 500 lines, and the latest `pnpm build`, `pnpm perf:runtime`, and `git diff --check HEAD --` run passed. `pnpm build` still reports the existing Vite chunk-size warning.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-11-document-dirty-state-budget-phase11.md src/features/documents/document-store.ts tests/frontend/document-store.test.ts src/components/layout/AppShell.tsx
git commit -m "Track dirty document state in store"
```
