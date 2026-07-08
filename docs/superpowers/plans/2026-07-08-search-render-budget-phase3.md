# Search Render Budget Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep search result selection, preview, and jump interactions responsive when search returns many results or a selected file is large.

**Architecture:** Preserve the existing result-window model and add a focused preview-window model. Search preview renders only a bounded window around the hit line while still reporting full file line count.

**Tech Stack:** React, Vitest, existing Search Everywhere components.

---

### Task 1: Preview Window Model

**Files:**
- Create: `src/features/search/search-preview-window.ts`
- Test: `tests/frontend/search-preview-window.test.ts`

- [ ] **Step 1: Write model tests**

Cover small files, large files, hit line near the beginning, and hit line near the end.

- [ ] **Step 2: Implement the model**

Expose `createSearchPreviewWindow(lines, hitLine, radius)` returning visible lines with original line numbers and full line count.

- [ ] **Step 3: Verify model**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/search-preview-window.test.ts
```

Expected: all tests pass.

### Task 2: Search Preview Integration

**Files:**
- Modify: `src/components/layout/SearchEverywherePanel.tsx`

- [ ] **Step 1: Replace full-file preview render**

Use `createSearchPreviewWindow` in `SearchPreview` so large files do not render every line.

- [ ] **Step 2: Preserve fallback context preview**

When full content is not available yet, keep the existing context-before/hit/context-after rendering.

- [ ] **Step 3: Verify focused search tests**

Run:

```bash
./node_modules/.bin/vitest run tests/frontend/search-preview-window.test.ts tests/frontend/search-result-window.test.ts tests/frontend/use-search-everywhere-preview.test.tsx tests/frontend/use-search-everywhere-navigation.test.tsx
```

Expected: all tests pass.

### Task 3: Release Checks

**Files:**
- Modify only files from Tasks 1 and 2.

- [ ] **Step 1: File size check**

Run:

```bash
wc -l src/features/search/search-preview-window.ts src/components/layout/SearchEverywherePanel.tsx tests/frontend/search-preview-window.test.ts
```

Expected: every code file is under 500 lines.

- [ ] **Step 2: Build and diff check**

Run:

```bash
pnpm build
git diff --check
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-07-08-search-render-budget-phase3.md src/features/search/search-preview-window.ts src/components/layout/SearchEverywherePanel.tsx tests/frontend/search-preview-window.test.ts
git commit -m "Bound search preview rendering"
```
