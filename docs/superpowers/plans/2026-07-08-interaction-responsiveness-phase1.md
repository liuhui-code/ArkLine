# Interaction Responsiveness Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Search Everywhere and Ctrl+Shift+F input, close, cancel, and jump interactions responsive while slower search and preview work is still running.

**Architecture:** Add a small search interaction runtime that owns query generations, preview generations, stale-result checks, and backend cancellation. Wire the search controller through that runtime so foreground edits and navigation can invalidate background work without blocking local input state.

**Tech Stack:** React hooks, Vitest, Tauri workspace API wrappers, existing search session store.

---

### Task 1: Search Interaction Runtime

**Files:**
- Create: `src/features/search/search-interaction-runtime.ts`
- Test: `tests/frontend/search-interaction-runtime.test.ts`

- [ ] **Step 1: Write failing runtime tests**

Add tests proving that new query sessions invalidate old sessions, foreground invalidation cancels active backend work, and preview generations can be invalidated independently.

- [ ] **Step 2: Implement runtime**

Create a focused runtime with `startQuery`, `invalidateForeground`, `startPreview`, `invalidatePreview`, `isCurrentQuery`, and `isCurrentPreview`.

- [ ] **Step 3: Verify runtime**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/search-interaction-runtime.test.ts
```

Expected: all runtime tests pass.

### Task 2: Search Controller Integration

**Files:**
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Test: `tests/frontend/use-search-everywhere-navigation.test.tsx`

- [ ] **Step 1: Add stale-result regression tests**

Add tests proving that a slow stale search cannot overwrite a newer result and a slow result cannot repopulate results after the panel closes.

- [ ] **Step 2: Replace local request refs**

Use the new runtime for query and preview generation checks. Keep the existing public hook contract unchanged.

- [ ] **Step 3: Clear transient work on invalidation**

When foreground input, close, or navigation invalidates the session, clear preview content and reset page loading so the UI never looks stuck on an obsolete request.

- [ ] **Step 4: Verify search controller**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/use-search-everywhere-navigation.test.tsx tests/frontend/use-search-everywhere-preview.test.tsx
```

Expected: search navigation, cancellation, and preview tests pass.

### Task 3: Release Checks

**Files:**
- Modify only files from Task 1 and Task 2.

- [ ] **Step 1: Enforce file-size policy**

Run:

```bash
wc -l src/features/search/search-interaction-runtime.ts src/components/layout/use-search-everywhere-controller.ts tests/frontend/search-interaction-runtime.test.ts tests/frontend/use-search-everywhere-navigation.test.tsx
```

Expected: every code file is under 500 lines.

- [ ] **Step 2: Run build and diff checks**

Run:

```bash
pnpm build
git diff --check
```

Expected: both commands pass.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-08-interaction-responsiveness-phase1.md src/features/search/search-interaction-runtime.ts src/components/layout/use-search-everywhere-controller.ts tests/frontend/search-interaction-runtime.test.ts tests/frontend/use-search-everywhere-navigation.test.tsx
git commit -m "Improve search interaction cancellation"
```
