# Code Search Result Reading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArkLine search results read like mature IDE/code-search tools: IDEA-style compact navigation for Search Everywhere and VS Code/Sourcegraph-style readable code hits for Find in Files.

**Architecture:** Keep `SearchEverywherePanel.tsx` as the orchestrator and move visual structure into `SearchResultItems.tsx`. Preserve existing search APIs, keyboard flow, click behavior, and preview loading; only change result markup and CSS hierarchy.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing `src/styles/app.css`.

---

### Task 1: Result Item Structure

**Files:**
- Modify: `src/components/layout/SearchResultItems.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Add IDE-style candidate rows**

Update `SearchCandidateResultItem` so each candidate has an icon badge, dominant title, compact kind/source metadata, and a muted path line.

- [x] **Step 2: Add code-search hit rows**

Update `TextSearchResultItem` so the hit code line owns the row. File metadata belongs to the file group header; individual matches should read like VS Code search hits: line number plus code snippet only.

- [x] **Step 3: Keep query highlighting reusable**

Keep highlight rendering local to `SearchResultItems.tsx`; do not add parser logic or search API changes.

### Task 2: Search Panel Styling

**Files:**
- Modify: `src/styles/app.css`

- [x] **Step 1: Apply IDEA palette density to Search Everywhere**

Use compact rows, subtle icon colors, group headers, and strong selected background for Double Shift results.

- [x] **Step 2: Apply VS Code/Sourcegraph code-hit readability to Find in Files**

Use monospaced hit text, stable line number column, grouped files, stronger selected hit background, and a Sourcegraph-like full-file preview.

- [x] **Step 3: Improve preview reading**

Keep the existing full-file preview but tune header, line height, hit line, and highlight color so the selected match is easy to read.

### Task 3: Tests and Verification

**Files:**
- Modify: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Assert Search Everywhere title highlight remains dominant**

Extend the existing Search Everywhere test to verify the highlighted title is rendered in the selected candidate row.

- [x] **Step 2: Assert Find in Files hit row hierarchy**

Extend the existing Find in Files keyboard test to verify hit text, line/column, file name, absolute path, and auto-scroll behavior.

- [x] **Step 3: Run checks**

Run:

```bash
pnpm exec tsc --noEmit -p tsconfig.app.json
pnpm exec vitest run tests/frontend/app-shell.test.tsx -t "opens Search Everywhere with class symbol|moves Find in Files focus"
git diff --check
```

Expected: all commands pass.
