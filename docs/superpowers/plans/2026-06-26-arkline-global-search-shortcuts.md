# ArkLine Global Search Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add IDE-standard Find in Files and Replace in Files shortcuts, then polish the global search panel into a grouped search-results experience.

**Architecture:** Keep one overlay surface and one search panel, with a lightweight mode state in `AppShell`. Extend the shell keymap and command palette instead of creating separate duplicated overlays. Replace UI is scaffolded without batch write execution until a safe diff-preview replace pipeline exists.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing ArkLine shell keybinding model.

---

## File Structure

- Modify `src/components/layout/shell-keymap.ts`: add `openFindInFiles` and `openReplaceInFiles` commands with `mod+shift+f/r`.
- Modify `src/components/layout/AppShell.tsx`: add search mode state, command handlers, palette actions, and panel props.
- Modify `src/components/layout/app-shell-helpers.ts`: add Command Palette items for Find in Files and Replace in Files.
- Modify `src/components/layout/TopBar.tsx`: add View menu items and callbacks for Find/Replace in Files.
- Modify `src/components/layout/SearchOverlayContent.tsx`: pass search mode and replace query into `SearchEverywherePanel`.
- Modify `src/components/layout/SearchEverywherePanel.tsx`: render mode-aware header, replace input, grouped result tree, and stable preview.
- Modify `src/styles/app.css`: style grouped search results and replace row within existing IDE palette style.
- Test `tests/frontend/shell-hotkeys.test.tsx`: verify shortcuts open the right modes.
- Test `tests/frontend/app-shell.test.tsx`: verify menu/palette/keymap visibility and grouped search result behavior.

---

### Task 1: Keymap And Command Entrypoints

**Files:**
- Modify: `src/components/layout/shell-keymap.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/shell-hotkeys.test.tsx`

- [x] **Step 1: Write failing hotkey tests**

Add tests proving `Ctrl+Shift+F` opens Find in Files and `Ctrl+Shift+R` opens Replace in Files.

Run: `pnpm test -- tests/frontend/shell-hotkeys.test.tsx`
Expected: FAIL because the commands and mode labels do not exist yet.

- [x] **Step 2: Add shell commands**

Add `openFindInFiles` and `openReplaceInFiles` to `ShellCommand`, with default keybindings:

```ts
{ id: "openFindInFiles", title: "Find in Files", category: "Navigation", defaultKeybindings: [{ mod: true, shift: true, key: "f" }] },
{ id: "openReplaceInFiles", title: "Replace in Files", category: "Navigation", defaultKeybindings: [{ mod: true, shift: true, key: "r" }] },
```

- [x] **Step 3: Add AppShell mode handlers**

Add `searchEverywhereMode: "searchEverywhere" | "find" | "replace"` and open helpers:

```ts
function openSearchOverlay(mode: SearchEverywhereMode) {
  setSearchEverywhereMode(mode);
  setOverlay("searchEverywhere");
}
```

Wire command handlers:

```ts
openSearchEverywhere: () => openSearchOverlay("searchEverywhere"),
openFindInFiles: () => openSearchOverlay("find"),
openReplaceInFiles: () => openSearchOverlay("replace"),
```

- [x] **Step 4: Verify hotkey tests pass**

Run: `pnpm test -- tests/frontend/shell-hotkeys.test.tsx`
Expected: PASS.

---

### Task 2: Menus, Command Palette, And Keymap Inventory

**Files:**
- Modify: `src/components/layout/app-shell-helpers.ts`
- Modify: `src/components/layout/TopBar.tsx`
- Modify: `src/components/settings/settings-sections/SettingsKeymapPanel.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Write failing UI inventory tests**

Add tests proving:

- View menu contains `Find in Files` with `Ctrl/Cmd+Shift+F`.
- View menu contains `Replace in Files` with `Ctrl/Cmd+Shift+R`.
- Command Palette can find both actions.
- Settings Keymap can find both shortcuts.

Run: `pnpm test -- tests/frontend/app-shell.test.tsx`
Expected: FAIL because these actions are missing.

- [x] **Step 2: Add command palette actions**

Extend `CommandPaletteAction` and `buildAppShellCommandPaletteItems` with:

```ts
{ id: "findInFiles", label: "Find in Files", shortcut: getShellCommandShortcut("openFindInFiles"), action: actions.openFindInFiles },
{ id: "replaceInFiles", label: "Replace in Files", shortcut: getShellCommandShortcut("openReplaceInFiles"), action: actions.openReplaceInFiles },
```

- [x] **Step 3: Add View menu items**

Add `onOpenFindInFiles` and `onOpenReplaceInFiles` props to `TopBar`, then render them near Search Everywhere.

- [x] **Step 4: Keep Double Shift visible in Keymap**

Keep the manual `Double Shift` row for Search Everywhere; the new Find/Replace rows come from `shellCommandDescriptors`.

- [x] **Step 5: Verify UI inventory tests pass**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx`
Expected: PASS.

---

### Task 3: Search Panel Mode And Grouped Results

**Files:**
- Modify: `src/components/layout/SearchOverlayContent.tsx`
- Modify: `src/components/layout/SearchEverywherePanel.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [x] **Step 1: Write failing grouped result tests**

Extend the workspace text search test to assert:

- Find mode title is `Find in Files`.
- Results show grouped file rows with hit counts.
- Match rows still open the selected file.
- Replace mode shows `Replace With`.

Run: `pnpm test -- tests/frontend/app-shell.test.tsx`
Expected: FAIL because the panel is still flat and has no replace field.

- [x] **Step 2: Add panel props**

Pass:

```ts
mode={searchEverywhereMode}
replaceQuery={searchEverywhereReplaceQuery}
onChangeReplaceQuery={setSearchEverywhereReplaceQuery}
```

- [x] **Step 3: Group matches in the panel**

Inside `SearchEverywherePanel`, derive file groups from `result.matches`, preserving flat indices for keyboard selection and click behavior.

- [x] **Step 4: Render grouped result tree**

Use semantic labels:

- `aria-label="Search Everywhere Results"`
- `aria-label="Find in Files Results"`
- `aria-label="Replace in Files Results"`

Keep result buttons clickable and keyboard-selection compatible.

- [x] **Step 5: Add CSS polish**

Style file groups, match rows, counts, relative paths, and replace input using the existing restrained IDE panel palette.

- [x] **Step 6: Verify grouped result tests pass**

Run: `pnpm test -- tests/frontend/app-shell.test.tsx`
Expected: PASS.

---

### Task 4: Final Verification And Commit

**Files:**
- All modified files above.

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm test -- tests/frontend/shell-hotkeys.test.tsx tests/frontend/app-shell.test.tsx tests/frontend/keybinding-model.test.ts
```

Expected: PASS.

- [x] **Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: PASS, unless the local package registry/network blocks dependency restoration. If blocked, record the exact error.

- [x] **Step 3: Inspect git diff**

Run:

```bash
git status --short
git diff -- docs/superpowers src tests
```

Expected: only planned files changed.

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-26-arkline-global-search-shortcuts-design.md docs/superpowers/plans/2026-06-26-arkline-global-search-shortcuts.md src tests
git commit -m "feat: add global search shortcuts"
```

Expected: commit succeeds.

## Execution Notes

- `./node_modules/.bin/vitest run tests/frontend/shell-hotkeys.test.tsx tests/frontend/app-shell.test.tsx --reporter=dot`: passed, 122 tests.
- `./node_modules/.bin/vitest run tests/frontend/keybinding-model.test.ts --reporter=dot`: passed, 5 tests.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.node.json`: passed.
- `./node_modules/.bin/vite build`: passed.
- `git diff --check`: passed.
- `pnpm build`: blocked before build by pnpm dependency approval, `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.21.5`.
- `./node_modules/.bin/tsc --noEmit -p tsconfig.app.json`: blocked by pre-existing test mock type errors around `listDeviceFaultLogs` / `DeviceLogStreamSummary`, unrelated to this search shortcut slice.
