# Document Store Notification Budget Phase 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce repeated React subscription refreshes when one document receives several updates in the same event loop turn.

**Architecture:** Keep document store writes synchronous for correctness, but coalesce subscriber notifications by normalized path into a microtask. Subscribers receive the latest document state once per path.

**Tech Stack:** TypeScript, React external store subscriptions, Vitest.

---

### Task 1: Document Notification Coalescing

**Files:**
- Modify: `src/features/documents/document-store.ts`
- Test: `tests/frontend/document-store.test.ts`

- [x] **Step 1: Add coalescing tests**

Verify repeated updates to the same path notify once with the latest document, while different paths still notify separately.

- [x] **Step 2: Implement microtask flush**

Replace immediate listener iteration with a pending path map and `queueMicrotask` flush.

- [x] **Step 3: Verify store tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/document-store.test.ts
```

Expected: all tests pass.

### Task 2: Hook Subscription Compatibility

**Files:**
- Test: `tests/frontend/use-active-document-content.test.tsx`
- Test: `tests/frontend/use-active-document-projection.test.tsx`

- [x] **Step 1: Update hook tests**

Use `waitFor` after document updates because notifications now flush through a microtask.

- [x] **Step 2: Verify focused hooks**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/document-store.test.ts tests/frontend/use-active-document-content.test.tsx tests/frontend/use-active-document-projection.test.tsx
```

Expected: all tests pass.

Actual: `tests/frontend/document-store.test.ts`, `tests/frontend/use-active-document-content.test.tsx`, and `tests/frontend/use-active-document-projection.test.tsx` passed.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2 plus this plan.

- [x] **Step 1: File size check**

Run:

```bash
wc -l src/features/documents/document-store.ts tests/frontend/document-store.test.ts tests/frontend/use-active-document-content.test.tsx tests/frontend/use-active-document-projection.test.tsx
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

Actual: focused document/search tests passed, all listed files are under 500 lines, and the latest `pnpm build`, `pnpm perf:runtime`, and `git diff --check HEAD --` run passed. `pnpm build` still reports the existing Vite chunk-size warning.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-11-document-store-notification-budget-phase10.md src/features/documents/document-store.ts tests/frontend/document-store.test.ts tests/frontend/use-active-document-content.test.tsx tests/frontend/use-active-document-projection.test.tsx
git commit -m "Coalesce document store notifications"
```
