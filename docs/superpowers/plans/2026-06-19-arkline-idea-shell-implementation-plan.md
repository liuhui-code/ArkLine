# ArkLine IDEA Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework ArkLine's frontend shell to match the approved IntelliJ IDEA New UI-inspired layout, interaction model, and exit behavior, then validate it against a small ArkTS UI demo project.

**Architecture:** Keep the existing Tauri and Rust backend contracts intact while restructuring the React shell into smaller layout-focused components, explicit tool-window state, and a keyboard/focus controller. Move diff presentation under a Git tool window, replace the current bottom split with a single tabbed bottom surface, and add deterministic exit paths for overlays and tool windows.

**Tech Stack:** React, TypeScript, Vite, Vitest, existing CodeMirror integration, existing frontend stores, existing Tauri workspace API, CSS tokens and app stylesheet.

---

## 1. File Structure and Responsibility Map

### Existing files to modify

- Modify: `src/components/layout/AppShell.tsx`
  - currently too large and holding layout, keyboard, state wiring, and surface rendering together
- Modify: `src/components/layout/ToolWindow.tsx`
  - keep as a primitive or tighten API if needed
- Modify: `src/features/workspace/MainWorkspaceView.tsx`
  - either absorb into the new shell structure or keep as a thin wrapper
- Modify: `src/styles/app.css`
  - replace current split-bottom and generic toolbar styling with IDEA-like shell rules
- Modify: `tests/frontend/app-shell.test.tsx`
  - expand to cover Project, bottom tool windows, and exit behavior

### New files to create

- Create: `src/components/layout/shell-keymap.ts`
  - key constants and simple key-matching helpers
- Create: `src/components/layout/useShellHotkeys.ts`
  - registers keyboard flows and focus/exit behavior
- Create: `src/components/layout/shell-state.ts`
  - local shell view-model helpers and enums for active surfaces
- Create: `src/components/layout/TopBar.tsx`
  - IDEA-like top shell bar
- Create: `src/components/layout/LeftToolRail.tsx`
  - narrow vertical rail for Project, Search, Git, Problems
- Create: `src/components/layout/ProjectToolWindow.tsx`
  - realistic tree rendering and selection surface
- Create: `src/components/layout/BottomToolWindow.tsx`
  - single tabbed bottom surface for Problems, Terminal, Git
- Create: `src/components/layout/ProblemsPanel.tsx`
  - validation-focused problems table
- Create: `src/components/layout/TerminalPanel.tsx`
  - MVP terminal placeholder surface with correct interaction contract
- Create: `src/components/layout/GitToolWindow.tsx`
  - Local Changes style list and diff host
- Create: `src/components/layout/OverlaySurface.tsx`
  - shared wrapper for Quick Open, Search Everywhere, Recent Files, and palette
- Create: `src/components/layout/demo-arkts-project.ts`
  - frontend fixture helper for the approved small ArkTS UI demo shape

### Tests to create

- Create: `tests/frontend/shell-hotkeys.test.tsx`
- Create: `tests/frontend/bottom-tool-window.test.tsx`
- Create: `tests/frontend/project-tool-window.test.tsx`
- Create: `tests/frontend/git-tool-window.test.tsx`

## 2. Task Decomposition

### Task 1: Split the shell into focused layout components

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/shell-state.ts`
- Create: `src/components/layout/TopBar.tsx`
- Create: `src/components/layout/LeftToolRail.tsx`
- Create: `src/components/layout/OverlaySurface.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing shell-composition test**

Add assertions to `tests/frontend/app-shell.test.tsx` for:

- top bar visible
- left tool rail visible
- bottom tool-window host visible
- AppShell no longer directly renders every surface inline

Suggested test additions:

```tsx
it("renders the approved shell regions", async () => {
  render(<AppShell workspaceApi={createWorkspaceApiDouble()} />);

  expect(screen.getByRole("banner")).toBeInTheDocument();
  expect(screen.getByLabelText("Primary Tool Window Rail")).toBeInTheDocument();
  expect(screen.getByLabelText("Bottom Tool Window")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm test -- --run tests/frontend/app-shell.test.tsx
```

Expected: fail because the current shell does not expose the new landmarks.

- [ ] **Step 3: Create shell-state and split AppShell responsibilities**

Implement:

- `shell-state.ts` with typed unions such as:

```ts
export type LeftToolKey = "project" | "search" | "git" | "problems";
export type BottomToolKey = "problems" | "terminal" | "git";
export type OverlayKey = "none" | "quickOpen" | "searchEverywhere" | "recentFiles" | "commandPalette";
```

- `TopBar.tsx`, `LeftToolRail.tsx`, and `OverlaySurface.tsx`
- trim `AppShell.tsx` down to orchestration and state wiring

- [ ] **Step 4: Run the shell test again**

Run:

```bash
pnpm test -- --run tests/frontend/app-shell.test.tsx
```

Expected: pass with the new shell landmarks present.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/layout/shell-state.ts src/components/layout/TopBar.tsx src/components/layout/LeftToolRail.tsx src/components/layout/OverlaySurface.tsx tests/frontend/app-shell.test.tsx
git commit -m "refactor: split shell layout into focused components"
```

### Task 2: Replace the bottom split with a real bottom tool window

**Files:**
- Create: `src/components/layout/BottomToolWindow.tsx`
- Create: `src/components/layout/ProblemsPanel.tsx`
- Create: `src/components/layout/TerminalPanel.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/bottom-tool-window.test.tsx`

- [ ] **Step 1: Write the failing bottom-tool-window test**

Create `tests/frontend/bottom-tool-window.test.tsx` covering:

- tabs `Problems`, `Terminal`, `Git`
- only one bottom panel visible at a time
- switching tabs replaces the active surface instead of rendering equal columns

Suggested test:

```tsx
it("shows one active bottom tool window panel at a time", async () => {
  render(<AppShell workspaceApi={createWorkspaceApiDouble()} />);

  await user.click(screen.getByRole("tab", { name: "Terminal" }));
  expect(screen.getByLabelText("Terminal Panel")).toBeVisible();
  expect(screen.queryByLabelText("Problems Panel")).not.toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm test -- --run tests/frontend/bottom-tool-window.test.tsx
```

Expected: fail because the current bottom area is not a single tabbed tool window.

- [ ] **Step 3: Implement BottomToolWindow and move Problems/Terminal/Git into tabs**

Implement:

- ARIA tablist semantics
- one active content panel
- `ProblemsPanel.tsx`
- `TerminalPanel.tsx` as an MVP shell surface with placeholder content and clear open/hide affordances
- update `app.css` to remove the equal-width bottom layout

- [ ] **Step 4: Run targeted tests**

Run:

```bash
pnpm test -- --run tests/frontend/bottom-tool-window.test.tsx tests/frontend/app-shell.test.tsx
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/BottomToolWindow.tsx src/components/layout/ProblemsPanel.tsx src/components/layout/TerminalPanel.tsx src/components/layout/AppShell.tsx src/styles/app.css tests/frontend/bottom-tool-window.test.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add idea-style bottom tool window"
```

### Task 3: Build a denser Project tool window for ArkTS projects

**Files:**
- Create: `src/components/layout/ProjectToolWindow.tsx`
- Create: `src/components/layout/demo-arkts-project.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/project-tool-window.test.tsx`

- [ ] **Step 1: Write the failing Project tool-window test**

Create `tests/frontend/project-tool-window.test.tsx` for:

- nested ArkTS directories render with indentation
- active path highlight exists
- approved sample files appear

Suggested test:

```tsx
it("renders an ArkTS-shaped project tree with active-path highlighting", async () => {
  render(<ProjectToolWindow tree={demoArkTsTree} activePath={"entry/src/main/ets/pages/Index.ets"} onOpen={vi.fn()} />);

  expect(screen.getByText("Index.ets")).toBeInTheDocument();
  expect(screen.getByText("EntryAbility.ets")).toBeInTheDocument();
  expect(screen.getByText("string.json")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the Project tool-window test and verify it fails**

Run:

```bash
pnpm test -- --run tests/frontend/project-tool-window.test.tsx
```

Expected: fail because the component does not exist yet.

- [ ] **Step 3: Implement ProjectToolWindow and sample ArkTS tree fixture**

Implement:

- a compact tree renderer with explicit nesting levels
- selected-row styles
- a demo fixture helper that mirrors the approved small ArkTS UI demo structure

- [ ] **Step 4: Wire ProjectToolWindow into AppShell**

Replace the current simplistic file-tree rendering in `AppShell.tsx` with the new component and preserve file-open behavior.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test -- --run tests/frontend/project-tool-window.test.tsx tests/frontend/app-shell.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/ProjectToolWindow.tsx src/components/layout/demo-arkts-project.ts src/components/layout/AppShell.tsx src/styles/app.css tests/frontend/project-tool-window.test.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add idea-like project tool window"
```

### Task 4: Move diff under an IDEA-like Git tool window

**Files:**
- Create: `src/components/layout/GitToolWindow.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/features/diff/unified-diff.ts`
- Test: `tests/frontend/git-tool-window.test.tsx`

- [ ] **Step 1: Write the failing Git tool-window test**

Create `tests/frontend/git-tool-window.test.tsx` for:

- `Local Changes` style changed-file list
- selecting a file shows diff in the Git surface
- no separate bottom `Diff` root tab

Suggested test:

```tsx
it("shows diff inside the Git tool window after selecting a changed file", async () => {
  render(<GitToolWindow files={demoDiffFiles} onOpenFile={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: /Index.ets/i }));
  expect(screen.getByLabelText("Git Diff Viewer")).toBeVisible();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm test -- --run tests/frontend/git-tool-window.test.tsx
```

Expected: fail because GitToolWindow is not implemented.

- [ ] **Step 3: Implement GitToolWindow**

Implement:

- changed-file list
- diff host using parsed unified diff data
- open-in-editor hook
- rollback / stage action placeholders if the backend action is not yet wired

- [ ] **Step 4: Wire GitToolWindow into BottomToolWindow**

Replace the current top-level diff panel path with a Git-owned bottom surface. Preserve existing diff loading behavior for now, but surface it inside Git.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm test -- --run tests/frontend/git-tool-window.test.tsx tests/frontend/bottom-tool-window.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/GitToolWindow.tsx src/components/layout/AppShell.tsx src/features/diff/unified-diff.ts tests/frontend/git-tool-window.test.tsx tests/frontend/bottom-tool-window.test.tsx
git commit -m "feat: move diff into git tool window"
```

### Task 5: Add IDEA-style hotkeys, focus return, and exit behavior

**Files:**
- Create: `src/components/layout/shell-keymap.ts`
- Create: `src/components/layout/useShellHotkeys.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/shell-hotkeys.test.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing hotkey and exit tests**

Create `tests/frontend/shell-hotkeys.test.tsx` covering:

- `Esc` closes overlays
- `Shift+Esc` hides focused tool windows
- `Ctrl+Shift+F12` hides all tool windows
- focus returns to editor after close

Suggested test:

```tsx
it("closes Quick Open with Escape and returns focus to the editor", async () => {
  render(<AppShell workspaceApi={createWorkspaceApiDouble()} />);

  await user.keyboard("{Control>}p{/Control}");
  expect(screen.getByLabelText("Quick Open Overlay")).toBeVisible();

  await user.keyboard("{Escape}");
  expect(screen.queryByLabelText("Quick Open Overlay")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Code Editor")).toHaveFocus();
});
```

- [ ] **Step 2: Run the hotkey test and verify it fails**

Run:

```bash
pnpm test -- --run tests/frontend/shell-hotkeys.test.tsx
```

Expected: fail because the current shell does not implement the approved key hierarchy.

- [ ] **Step 3: Implement shell-keymap and useShellHotkeys**

Implement:

- typed key definitions
- handlers for `Double Shift`, `Ctrl+Shift+A`, `Ctrl+P`, `Ctrl+E`, `Ctrl+Shift+E`, `Alt+1`, `Alt+4`, `Alt+9`, `Alt+F12`, `Ctrl+Tab`, `Shift+Esc`, `Ctrl+Shift+F12`
- deterministic focus return to editor

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm test -- --run tests/frontend/shell-hotkeys.test.tsx tests/frontend/app-shell.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/shell-keymap.ts src/components/layout/useShellHotkeys.ts src/components/layout/AppShell.tsx tests/frontend/shell-hotkeys.test.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add idea-style shell hotkeys and exits"
```

### Task 6: Validate the shell against a small ArkTS UI demo

**Files:**
- Modify: `tests/frontend/app-shell.test.tsx`
- Modify: `README.md`
- Modify: `gitlog.md`

- [ ] **Step 1: Add an integration-style shell test around the approved sample shape**

Extend `tests/frontend/app-shell.test.tsx` or add a focused case verifying:

- Project shows the ArkTS sample paths
- bottom tab switching works
- Git diff opens for a changed sample file
- exit keys work in sequence

- [ ] **Step 2: Run the integration shell tests**

Run:

```bash
pnpm test -- --run tests/frontend/app-shell.test.tsx tests/frontend/project-tool-window.test.tsx tests/frontend/git-tool-window.test.tsx tests/frontend/shell-hotkeys.test.tsx tests/frontend/bottom-tool-window.test.tsx
```

Expected: all pass.

- [ ] **Step 3: Update docs**

Update `README.md` to describe:

- IDEA-inspired shell direction
- bottom `Problems / Terminal / Git`
- the approved key exits

Update `gitlog.md` with the implementation summary.

- [ ] **Step 4: Run the full frontend test suite**

Run:

```bash
pnpm test
```

Expected: all frontend tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/frontend/app-shell.test.tsx tests/frontend/project-tool-window.test.tsx tests/frontend/git-tool-window.test.tsx tests/frontend/shell-hotkeys.test.tsx tests/frontend/bottom-tool-window.test.tsx README.md gitlog.md
git commit -m "feat: validate idea shell against arkts demo"
```

## 3. Plan Self-Review

### Spec coverage

Covered spec sections:

- IDEA New UI shell layout: Tasks 1 to 3
- Project tree density and ArkTS structure: Task 3
- unified bottom tool window: Task 2
- Git-owned diff flow: Task 4
- keyboard and exit rules: Task 5
- small ArkTS UI demo validation: Task 6

No intentional spec gaps remain for this shell-focused plan.

### Placeholder scan

Checked for:

- `TBD`
- `TODO`
- vague “add tests” without file paths
- vague “implement behavior” without commands

No unresolved placeholders remain.

### Type consistency

The plan consistently uses:

- `LeftToolKey`
- `BottomToolKey`
- `OverlayKey`
- `GitToolWindow`
- `BottomToolWindow`
- `ProjectToolWindow`

These names should be used consistently during implementation unless a stronger existing local name is discovered before code edits begin.
