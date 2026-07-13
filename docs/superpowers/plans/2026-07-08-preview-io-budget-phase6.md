# Preview IO Budget Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Search Everywhere preview selection from reading unopened files through the backend while preserving full preview for already loaded documents.

**Architecture:** Keep full-text search fallback reads unchanged, but make preview reads cache-only. If the target file is active or already open, preview can use in-memory content; otherwise the panel keeps the search-result context snippet.

**Tech Stack:** React hooks, Vitest, existing search preview loader.

---

### Task 1: Cache-Only Preview Reads

**Files:**
- Modify: `src/components/layout/use-search-everywhere-controller.ts`
- Test: `tests/frontend/use-search-everywhere-preview.test.tsx`

- [x] **Step 1: Add regression tests**

Verify unopened search results do not call `workspaceApi.openFile` for preview, and already open documents still provide preview content.

- [x] **Step 2: Implement cache-only preview reads**

Make `scheduleSelectedPreview` call `readSearchFile(path, false)` while full text search fallback keeps `readSearchFile(path, true)`.

- [x] **Step 3: Verify focused tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/use-search-everywhere-preview.test.tsx tests/frontend/use-search-everywhere-navigation.test.tsx
```

Expected: all tests pass.

Actual: `tests/frontend/search-file-reader.test.ts`, `tests/frontend/search-preview-action.test.ts`, `tests/frontend/search-preview-session.test.ts`, `tests/frontend/use-search-everywhere-preview.test.tsx`, and `tests/frontend/use-search-everywhere-navigation.test.tsx` passed.

### Task 2: Release Checks

**Files:**
- Modify only files from Task 1 plus this plan.

- [x] **Step 1: File size check**

Run:

```bash
wc -l src/components/layout/use-search-everywhere-controller.ts src/components/layout/search-file-reader.ts src/components/layout/search-preview-action.ts src/features/search/search-preview-session.ts tests/frontend/use-search-everywhere-preview.test.tsx tests/frontend/search-file-reader.test.ts tests/frontend/search-preview-action.test.ts tests/frontend/search-preview-session.test.ts docs/superpowers/plans/2026-07-08-preview-io-budget-phase6.md
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

Actual: `pnpm build`, `pnpm perf:runtime`, and `git diff --check HEAD --` passed. `pnpm build` still reports the existing Vite chunk-size warning.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-08-preview-io-budget-phase6.md src/components/layout/use-search-everywhere-controller.ts tests/frontend/use-search-everywhere-preview.test.tsx
git commit -m "Avoid backend reads for search previews"
```
