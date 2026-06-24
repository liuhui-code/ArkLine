# Keybinding Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ArkLine's hard-coded shell shortcut handling with a command/keybinding foundation that preserves current behavior and makes shortcuts visible in command/menu UI.

**Architecture:** Add a focused command/keybinding model under `src/components/layout/`, keep command execution in `AppShell`, and let shell hotkeys, Command Palette, and TopBar read from the same command metadata. This pass does not add user-editable keymaps; it creates the foundation needed for a future Settings Keymap page.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing AppShell layout components.

---

### Task 1: Command And Keybinding Model

**Files:**
- Create: `src/components/layout/keybinding-model.ts`
- Create: `tests/frontend/keybinding-model.test.ts`
- Modify: `src/components/layout/shell-keymap.ts`

- [ ] **Step 1: Write tests for key normalization and command resolution**

Create `tests/frontend/keybinding-model.test.ts` with coverage for `Mod`, `Alt`, `Shift+Escape`, command metadata, and no-match behavior.

- [ ] **Step 2: Implement `keybinding-model.ts`**

Define `Keybinding`, `CommandDescriptor`, `KeybindingContext`, `formatKeybinding()`, `matchesKeybinding()`, and `resolveKeybindingCommand()`. Keep context support minimal but explicit: `editorFocus`, `completionOpen`, `overlayOpen`, `settingsOpen`, and `settingsApplying`.

- [ ] **Step 3: Replace hard-coded resolver internals**

Update `shell-keymap.ts` so `resolveShellCommand()` delegates to `resolveKeybindingCommand()` while preserving the exported `ShellCommand` type and all existing shortcuts.

- [ ] **Step 4: Run targeted model tests**

Run: `pnpm test -- tests/frontend/keybinding-model.test.ts`

Expected: all new tests pass.

### Task 2: Shell Hotkey Context

**Files:**
- Modify: `src/components/layout/useShellHotkeys.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/shell-hotkeys.test.tsx`

- [ ] **Step 1: Add context argument to `useShellHotkeys`**

Allow `AppShell` to pass the current overlay/settings state into the resolver without changing the `onCommand` callback contract.

- [ ] **Step 2: Pass AppShell context**

Derive context from `activeOverlay`, `settingsVisible`, and `settingsApplyState.status`. Preserve completion-specific capture handling in `AppShell`.

- [ ] **Step 3: Run existing shell hotkey tests**

Run: `pnpm test -- tests/frontend/shell-hotkeys.test.tsx`

Expected: existing shell behavior remains unchanged.

### Task 3: Command Palette Shortcut Badges

**Files:**
- Modify: `src/components/layout/search-overlay-model.ts`
- Modify: `src/components/layout/app-shell-helpers.ts`
- Modify: `src/components/layout/SearchOverlayContent.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Extend command palette item shape**

Add an optional `shortcut` display field to command palette items.

- [ ] **Step 2: Feed shortcuts from command metadata**

Update `buildAppShellCommandPaletteItems()` to attach formatted shortcut text for commands that have a default shortcut.

- [ ] **Step 3: Render shortcut badges**

Render the shortcut at the right side of each command palette result while keeping the existing button labels accessible.

- [ ] **Step 4: Add a focused UI test**

Add a test asserting Command Palette shows shortcuts for existing actions such as `Go to Definition` and `Code Completion`.

### Task 4: TopBar Menu Shortcut Hints

**Files:**
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Render menu rows with shortcut hints**

Show shortcut text for `Command Palette`, `Search Everywhere`, `Terminal`, and `Editor Only`.

- [ ] **Step 2: Preserve click behavior**

Keep the same `onClick` handlers and role/menu semantics.

- [ ] **Step 3: Add a focused UI test**

Add a test that opens the View/Edit menu and verifies visible shortcut hints.

### Task 5: Verification

**Files:**
- Existing tests only.

- [ ] **Step 1: Run targeted tests**

Run: `pnpm test -- tests/frontend/keybinding-model.test.ts tests/frontend/shell-hotkeys.test.tsx tests/frontend/app-shell.test.tsx`

- [ ] **Step 2: Run build**

Run: `pnpm build`

- [ ] **Step 3: Review git diff**

Run: `git status --short` and `git diff --stat`

Expected: only keybinding foundation, palette/menu display, tests, and this plan are changed.
