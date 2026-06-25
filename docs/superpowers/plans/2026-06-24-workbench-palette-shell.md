# Workbench Palette Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first reusable workbench layer by unifying Quick Open, Command Palette, Recent Files, Recent Projects, and Go To Line under one IDE-style PaletteShell.

**Architecture:** Keep `SearchEverywherePanel` as the richer search palette, but replace the older generic `quick-open` wrapper for the other transient overlays with a `PaletteShell` component that owns header, close button, backdrop click, sizing, and panel semantics. `SearchOverlayContent` remains responsible for per-palette inputs and results.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing CSS tokens and shell overlay flow.

---

### Task 1: Palette Shell Component

**Files:**
- Create: `src/components/layout/PaletteShell.tsx`
- Modify: `src/components/layout/OverlaySurface.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Write failing interaction test**

Add a test that opens Command Palette, verifies a compact palette header and close button, verifies clicking inside the panel keeps it open, and verifies clicking the backdrop closes it.

- [x] **Step 2: Implement `PaletteShell`**

Create a shell component with:
- `aria-label="<label> Overlay"` on the full-screen backdrop.
- `role="dialog"` on the panel.
- Header with title, optional description, and compact `×` close button.
- `onMouseDown` backdrop close.
- `onMouseDown` panel stop propagation.

- [x] **Step 3: Route non-search overlays through `PaletteShell`**

Update `OverlaySurface` so `quickOpen`, `commandPalette`, `recentFiles`, `recentProjects`, and `goToLine` use `PaletteShell`. Keep Search Everywhere on its dedicated larger palette structure for now.

- [x] **Step 4: Add CSS**

Add `palette-shell`, `palette-shell__panel`, `palette-shell__header`, `palette-shell__close`, and `palette-shell__body` styles. Reuse existing color tokens and avoid new hard-coded decorative colors.

### Task 2: Palette Content Polish

**Files:**
- Modify: `src/components/layout/SearchOverlayContent.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Add semantic row text**

Keep existing result behavior but ensure command palette rows use title + shortcut layout, recent project rows use title + meta, and Go To Line has a stable one-row result area.

- [x] **Step 2: Add empty states**

Show `No actions found`, `No recent files`, `No recent projects`, or `No files found` where a palette result list is empty.

- [x] **Step 3: Test no-match state**

Add a focused test for Command Palette no-match state.

### Task 3: Bottom Tool Window Chrome Polish

**Files:**
- Modify: `src/components/layout/BottomToolWindow.tsx`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Add maximize/restore chrome action**

Expose the existing bottom tool window max-height toggle as a visible chrome action with stable accessible labels.

- [x] **Step 2: Fix terminal active state after close**

Make the top-bar Terminal active state depend on both the selected bottom tool and bottom tool window visibility, so closing the panel clears the visible active affordance while keeping toolbar restore behavior.

- [x] **Step 3: Add explicit collapsed restore action**

Replace the collapsed-state close affordance with a clear `Show Bottom Tool Window` action, preserving the last active bottom tool when restoring.

### Task 4: Verification

**Files:**
- Existing tests only.

- [ ] **Step 1: Run focused tests**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx -t "palette"`

- [x] **Step 2: Run shell and app tests**

Run: `pnpm test -- tests/frontend/shell-hotkeys.test.tsx tests/frontend/app-shell.test.tsx`

- [x] **Step 3: Run build**

Run: `pnpm build`

- [ ] **Step 4: Inspect diff**

Run: `git status --short` and `git diff --stat`.
