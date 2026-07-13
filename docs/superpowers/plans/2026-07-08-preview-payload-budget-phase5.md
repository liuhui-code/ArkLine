# Preview Payload Budget Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent large search preview files from allocating full line arrays in the Search Everywhere panel.

**Architecture:** Extend the preview-window model with a content scanner that counts lines and extracts only the hit-line window. The UI keeps rendering the same preview model but stops calling `content.split()` for full files.

**Tech Stack:** TypeScript, React, Vitest.

---

### Task 1: Content Preview Scanner

**Files:**
- Modify: `src/features/search/search-preview-window.ts`
- Test: `tests/frontend/search-preview-window.test.ts`

- [x] **Step 1: Add scanner tests**

Verify that content scanning preserves line numbers, handles CRLF, handles empty content, and extracts only the requested hit-line window.

- [x] **Step 2: Implement scanner**

Add `createSearchPreviewWindowFromContent(content, hitLine, radius)` using a bounded collection pass instead of `content.split()`.

- [x] **Step 3: Verify model**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/search-preview-window.test.ts
```

Expected: all tests pass.

### Task 2: Search Preview Integration

**Files:**
- Modify: `src/components/layout/SearchPreviewPane.tsx`

- [x] **Step 1: Remove full-content split from component**

Use `createSearchPreviewWindowFromContent` when preview content is available.

- [x] **Step 2: Keep loading fallback behavior**

When content is `null`, keep rendering the existing search-context preview.

- [x] **Step 3: Verify focused search tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/search-preview-window.test.ts tests/frontend/use-search-everywhere-preview.test.tsx tests/frontend/use-search-everywhere-navigation.test.tsx
```

Expected: all tests pass.

Actual: `tests/frontend/search-preview-window.test.ts`, `tests/frontend/SearchPreviewPane.test.tsx`, `tests/frontend/search-result-window.test.ts`, `tests/frontend/use-search-everywhere-preview.test.tsx`, and `tests/frontend/use-search-everywhere-navigation.test.tsx` passed.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2 plus this plan.

- [x] **Step 1: File size check**

Run:

```bash
wc -l src/features/search/search-preview-window.ts src/components/layout/SearchPreviewPane.tsx tests/frontend/search-preview-window.test.ts tests/frontend/SearchPreviewPane.test.tsx docs/superpowers/plans/2026-07-08-preview-payload-budget-phase5.md
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
git add docs/superpowers/plans/2026-07-08-preview-payload-budget-phase5.md src/features/search/search-preview-window.ts tests/frontend/search-preview-window.test.ts src/components/layout/SearchPreviewPane.tsx tests/frontend/SearchPreviewPane.test.tsx
git commit -m "Avoid full split for search previews"
```
