# Navigation Transaction Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make file open and search-result navigation visibly responsive and stale-safe while file content is still loading.

**Architecture:** Add a focused navigation transaction runtime that owns monotonically increasing transaction ids and stale checks. Wire editor surface file opening through this runtime so pending, success, stale, and failure paths are explicit without changing the public AppShell contract.

**Tech Stack:** React hooks, Vitest, existing workspace API and editor document stores.

---

### Task 1: Navigation Transaction Runtime

**Files:**
- Create: `src/features/navigation/navigation-transaction-runtime.ts`
- Test: `tests/frontend/navigation-transaction-runtime.test.ts`

- [x] **Step 1: Write runtime tests**

Cover starting a transaction, checking whether it is current, completing it, and invalidating an older transaction when a newer one starts.

- [x] **Step 2: Implement runtime**

Expose `start(path)`, `isCurrent(id)`, `finish(id)`, and `getCurrent()`.

- [x] **Step 3: Verify runtime**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/navigation-transaction-runtime.test.ts
```

Expected: all tests pass.

### Task 2: Editor Open File Transaction

**Files:**
- Modify: `src/components/layout/use-editor-surface-controller.ts`
- Test: `tests/frontend/use-editor-surface-controller.test.tsx`

- [x] **Step 1: Add pending and failure tests**

Verify `openFile` reports `Opening <file>...` before `workspaceApi.openFile` resolves, and reports `Open failed <file>` only for the latest request.

- [x] **Step 2: Replace local request id**

Use the navigation runtime instead of a raw `useRef` counter.

- [x] **Step 3: Keep stale requests isolated**

Ensure stale successes do not open tabs/documents and stale failures do not overwrite latest status.

- [x] **Step 4: Verify editor controller**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/navigation-transaction-runtime.test.ts tests/frontend/use-editor-surface-controller.test.tsx tests/frontend/use-editor-navigation.test.tsx
```

Expected: navigation and editor open tests pass.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2.

- [x] **Step 1: File size check**

Run:

```bash
wc -l src/features/navigation/navigation-transaction-runtime.ts src/components/layout/use-editor-surface-controller.ts tests/frontend/navigation-transaction-runtime.test.ts tests/frontend/use-editor-surface-controller.test.tsx
```

Expected: every code file is under 500 lines.

- [x] **Step 2: Build and diff check**

Run:

```bash
pnpm build
git diff --check
```

Expected: both pass.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-08-navigation-transaction-phase2.md src/features/navigation/navigation-transaction-runtime.ts src/components/layout/use-editor-surface-controller.ts tests/frontend/navigation-transaction-runtime.test.ts tests/frontend/use-editor-surface-controller.test.tsx
git commit -m "Add editor navigation transactions"
```

## Completion Notes

- `createNavigationTransactionRuntime` owns monotonic navigation transaction ids and stale checks.
- `useEditorSurfaceController` uses the runtime for async file opens and restore paths.
- Pending open status is emitted before content loads.
- Stale successes do not open tabs or cache stale document content.
- Stale failures do not overwrite the latest navigation status.
- Focused coverage includes 20 out-of-order navigation requests and already-loaded document activation.
- Verified with:
  - `pnpm test -- --run tests/frontend/navigation-transaction-runtime.test.ts tests/frontend/use-editor-surface-controller.test.tsx tests/frontend/use-editor-navigation.test.tsx`
  - `wc -l src/features/navigation/navigation-transaction-runtime.ts src/components/layout/use-editor-surface-controller.ts tests/frontend/navigation-transaction-runtime.test.ts tests/frontend/use-editor-surface-controller.test.tsx`
