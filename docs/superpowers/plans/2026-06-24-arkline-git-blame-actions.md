# ArkLine Git Blame Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Git Blame operation loop with command palette actions, a status bar menu, richer blame card actions, Escape handling, and save-triggered refresh.

**Architecture:** Keep Git data loading in `use-git-trace.ts`, adding a `refreshToken` so explicit refreshes and saves reload raw blame without re-running Git on each keystroke. Keep `AppShell` as the coordinator for UI state and commands, while `ShellStatusBar` and `GitBlameCard` remain presentational. Use existing command palette and bottom tool window patterns rather than introducing a new menu system.

**Tech Stack:** React, TypeScript, CodeMirror, Vitest, Testing Library, Tauri Rust tests.

---

## File Structure

- Modify `src/components/layout/use-git-trace.ts`
  - Add `refreshToken` input and refresh status metadata.
- Modify `src/components/layout/AppShell.tsx`
  - Own blame menu/card state, command handlers, Escape priority, save-triggered refresh, and command palette wiring.
- Modify `src/components/layout/ShellStatusBar.tsx`
  - Render the blame status control and anchored action menu.
- Modify `src/components/layout/GitBlameCard.tsx`
  - Split committed/local actions and expose `Show Commit`, `Show Diff`, `Copy Hash`, `Show Local Diff`, and `Close`.
- Modify `src/components/layout/app-shell-helpers.ts`
  - Add command palette items for blame actions.
- Modify `src/styles/app.css`
  - Style status menu and updated card actions.
- Modify `tests/frontend/app-shell.test.tsx`
  - Cover status menu, command palette, card actions, Escape behavior, save refresh, and no repeated blame calls while typing.

---

### Task 1: Add Explicit Blame Refresh Token

**Files:**
- Modify: `src/components/layout/use-git-trace.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing refresh test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("refreshes Git Blame once when the status menu refresh action is selected", async () => {
  const user = userEvent.setup();
  const getFileBlame = vi.fn(async () => [
    {
      line: 1,
      commit: "aaa1111",
      sourceLine: 1,
      author: "Jane Doe",
      authoredAt: "2026-06-20T10:00:00Z",
      relativeTime: "4d ago",
      summary: "Add entry component",
    },
  ]);
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame,
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await screen.findByText("Blame: Jane Doe, 4d ago");

  expect(getFileBlame).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Blame actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Refresh Blame" }));

  await waitFor(() => expect(getFileBlame).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Blame refreshed/)).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "refreshes Git Blame once"
```

Expected: FAIL because there is no status menu or refresh token.

- [ ] **Step 3: Add refresh token to `useGitTrace`**

Update `UseGitTraceArgs` in `src/components/layout/use-git-trace.ts`:

```ts
type UseGitTraceArgs = {
  activeLine: number;
  activePath: string | null;
  activeText: string;
  baseText: string;
  activeTool: "problems" | "terminal" | "git" | "gitTrace" | "usages";
  refreshToken: number;
  workspaceApi: WorkspaceApi;
};
```

Add `refreshToken` to the raw blame loading effect dependency list:

```ts
}, [activePath, baseText, refreshToken, workspaceApi]);
```

Keep `activeText` out of that dependency list so typing remaps locally but does not re-run Git.

- [ ] **Step 4: Add refresh state in `AppShell`**

In `src/components/layout/AppShell.tsx`, add:

```ts
const [gitBlameRefreshToken, setGitBlameRefreshToken] = useState(0);
```

Pass it into `useGitTrace`:

```tsx
refreshToken={gitBlameRefreshToken}
```

Add an action:

```ts
function refreshGitBlame() {
  if (!activePath) {
    setStatusText("Git Blame unavailable: no active file");
    return;
  }
  setGitBlameRefreshToken((token) => token + 1);
  setStatusText("Blame refreshed");
}
```

- [ ] **Step 5: Run refresh test**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "refreshes Git Blame once"
```

Expected: PASS after the status menu from Task 2 is implemented. If run before Task 2, it remains failing because the menu does not exist.

Do not commit Task 1 separately until Task 2 makes the user-visible refresh action available.

---

### Task 2: Add Status Bar Blame Menu

**Files:**
- Modify: `src/components/layout/ShellStatusBar.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing status menu test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("opens the current-line blame card from the status bar menu without switching bottom tools", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByRole("tab", { name: "Terminal" }));
  await user.click(screen.getByRole("button", { name: "Blame actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Show Current Line Commit" }));

  expect(await screen.findByRole("dialog", { name: "Git Blame Details" })).toHaveTextContent("Add entry component");
  expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
});
```

- [ ] **Step 2: Run status menu test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "status bar menu"
```

Expected: FAIL because `Blame actions` menu does not exist.

- [ ] **Step 3: Extend `ShellStatusBar` props**

In `src/components/layout/ShellStatusBar.tsx`, add props:

```ts
gitBlameMenuOpen: boolean;
onToggleGitBlameMenu: () => void;
onToggleGitBlame: () => void;
onRefreshGitBlame: () => void;
onShowCurrentLineBlame: () => void;
onCloseGitBlame: () => void;
```

- [ ] **Step 4: Render menu control**

Replace the current blame toggle button with:

```tsx
<div className="status-blame-menu">
  <button
    type="button"
    className={`status-pill status-pill--button${gitBlameVisible ? " status-pill--active" : ""}`}
    aria-label="Blame actions"
    aria-expanded={gitBlameMenuOpen}
    onClick={onToggleGitBlameMenu}
  >
    {gitBlameVisible ? "Blame On" : "Blame Off"}
  </button>
  {gitBlameMenuOpen ? (
    <div role="menu" aria-label="Git Blame Actions" className="status-blame-menu__popup">
      <button type="button" role="menuitem" onClick={onToggleGitBlame}>Toggle Git Blame</button>
      <button type="button" role="menuitem" onClick={onRefreshGitBlame}>Refresh Blame</button>
      <button type="button" role="menuitem" onClick={onShowCurrentLineBlame}>Show Current Line Commit</button>
      <button type="button" role="menuitem" onClick={onCloseGitBlame}>Close Blame</button>
    </div>
  ) : null}
</div>
```

- [ ] **Step 5: Wire menu state in `AppShell`**

Add:

```ts
const [gitBlameMenuOpen, setGitBlameMenuOpen] = useState(false);
```

Add actions:

```ts
function toggleGitBlameMenu() {
  setGitBlameMenuOpen((open) => !open);
}

function closeGitBlame() {
  setGitBlameVisible(false);
  setSelectedBlameAttribution(null);
  setGitBlameMenuOpen(false);
}

function showCurrentLineBlame() {
  const attribution = gitTraceState.blameAttributions.find((item) => item.bufferLine === editorSelection.line) ?? null;
  if (!attribution) {
    setStatusText("Git Blame unavailable for current line");
    setGitBlameMenuOpen(false);
    return;
  }
  setSelectedBlameAttribution(attribution);
  setGitBlameMenuOpen(false);
}
```

Update `toggleGitBlame` and `refreshGitBlame` to close the menu after activation.

- [ ] **Step 6: Add menu styles**

In `src/styles/app.css`, add:

```css
.status-blame-menu {
  position: relative;
  display: inline-flex;
}

.status-blame-menu__popup {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  z-index: 30;
  min-width: 190px;
  padding: 4px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-surface);
  box-shadow: 0 12px 28px rgb(0 0 0 / 18%);
}

.status-blame-menu__popup button {
  width: 100%;
  min-height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  text-align: left;
}

.status-blame-menu__popup button:hover,
.status-blame-menu__popup button:focus-visible {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
}
```

- [ ] **Step 7: Run status menu and refresh tests**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "refreshes Git Blame once|status bar menu"
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/layout/use-git-trace.ts src/components/layout/AppShell.tsx src/components/layout/ShellStatusBar.tsx src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: add git blame status actions"
```

---

### Task 3: Add Command Palette Blame Actions

**Files:**
- Modify: `src/components/layout/app-shell-helpers.ts`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing command palette test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("runs Git Blame actions from the command palette", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
  });

  const { container } = render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.keyboard("{Meta>}p{/Meta}");
  await user.type(screen.getByPlaceholderText("Search commands, files, symbols..."), "Toggle Git Blame");
  await user.click(await screen.findByText("Toggle Git Blame"));

  expect(container.querySelector(".cm-git-trace-marker")).toBeTruthy();

  await user.keyboard("{Meta>}p{/Meta}");
  await user.type(screen.getByPlaceholderText("Search commands, files, symbols..."), "Show Current Line Git Blame");
  await user.click(await screen.findByText("Show Current Line Git Blame"));

  expect(await screen.findByRole("dialog", { name: "Git Blame Details" })).toHaveTextContent("Add entry component");
});
```

- [ ] **Step 2: Run command palette test to verify it fails**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "command palette"
```

Expected: FAIL because blame commands are missing.

- [ ] **Step 3: Extend command helper action args**

In `src/components/layout/app-shell-helpers.ts`, add actions to `buildAppShellCommandPaletteItems` args:

```ts
toggleGitBlame: () => void;
refreshGitBlame: () => void;
showCurrentLineBlame: () => void;
closeGitBlame: () => void;
```

Add command items:

```ts
{ label: "Toggle Git Blame", detail: "Show or hide full-file Git blame annotations", action: actions.toggleGitBlame },
{ label: "Refresh Git Blame", detail: "Reload Git blame for the active file", action: actions.refreshGitBlame },
{ label: "Show Current Line Git Blame", detail: "Open blame details for the current line", action: actions.showCurrentLineBlame },
{ label: "Close Git Blame", detail: "Hide Git blame annotations and details", action: actions.closeGitBlame },
```

- [ ] **Step 4: Pass actions from `AppShell`**

Update the `buildAppShellCommandPaletteItems` call in `AppShell.tsx` to include the four blame actions.

- [ ] **Step 5: Run command palette test**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "command palette"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/app-shell-helpers.ts src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add git blame command palette actions"
```

---

### Task 4: Complete Blame Card Actions

**Files:**
- Modify: `src/components/layout/GitBlameCard.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles/app.css`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing committed-card test**

Add to `tests/frontend/app-shell.test.tsx`:

```ts
it("copies a committed blame hash from the blame card", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn(async () => undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111ffff",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByRole("button", { name: "Blame actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Show Current Line Commit" }));
  await user.click(await screen.findByRole("button", { name: "Copy Hash" }));

  expect(writeText).toHaveBeenCalledWith("aaa1111ffff");
  expect(screen.getByText("Copied commit aaa1111")).toBeVisible();
});
```

- [ ] **Step 2: Write failing local-card test**

Add:

```ts
it("opens the Git diff view for a local uncommitted blame row", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
    loadDiff: async () => "diff --git a/src/main.ets b/src/main.ets\n+@Component",
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(await screen.findByLabelText("Editor Content"));
  await user.keyboard("{Home}{Enter}@Component");
  await user.click(screen.getByRole("button", { name: "Blame actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Show Current Line Commit" }));
  await user.click(await screen.findByRole("button", { name: "Show Local Diff" }));

  expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByText("src/main.ets")).toBeVisible();
});
```

- [ ] **Step 3: Run card tests to verify they fail**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "blame hash|local uncommitted"
```

Expected: FAIL because the card does not expose the new action split.

- [ ] **Step 4: Extend `GitBlameCard` props**

Update `src/components/layout/GitBlameCard.tsx`:

```ts
type GitBlameCardProps = {
  attribution: GitBlameAttribution;
  onClose: () => void;
  onShowCommit: () => void;
  onShowDiff: () => void;
  onShowLocalDiff: () => void;
  onCopyHash: () => void;
};
```

Render committed rows with:

```tsx
<button type="button" onClick={onShowCommit}>Show Commit</button>
<button type="button" onClick={onShowDiff}>Show Diff</button>
<button type="button" onClick={onCopyHash} disabled={!attribution.commit}>Copy Hash</button>
<button type="button" onClick={onClose}>Close</button>
```

Render local rows with:

```tsx
<button type="button" onClick={onShowLocalDiff}>Show Local Diff</button>
<button type="button" onClick={onClose}>Close</button>
```

- [ ] **Step 5: Wire actions in `AppShell`**

Add:

```ts
function showSelectedBlameCommit() {
  if (!selectedBlameAttribution?.commit) return;
  showBottomTool("gitTrace");
}

async function showSelectedLocalDiff() {
  await loadDiff();
  setSelectedBlameAttribution(null);
}
```

Pass `onShowCommit`, `onShowDiff`, `onShowLocalDiff`, and `onCopyHash` to `GitBlameCard`.

- [ ] **Step 6: Run card tests**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "blame hash|local uncommitted"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/GitBlameCard.tsx src/components/layout/AppShell.tsx src/styles/app.css tests/frontend/app-shell.test.tsx
git commit -m "feat: complete git blame card actions"
```

---

### Task 5: Add Escape Priority and Save-Triggered Refresh

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write failing Escape test**

Add:

```ts
it("closes blame menu and card with Escape before broader UI handling", async () => {
  const user = userEvent.setup();
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}",
    getFileBlame: async () => [
      {
        line: 1,
        commit: "aaa1111",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-20T10:00:00Z",
        relativeTime: "4d ago",
        summary: "Add entry component",
      },
    ],
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(screen.getByRole("button", { name: "Blame actions" }));
  expect(screen.getByRole("menu", { name: "Git Blame Actions" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu", { name: "Git Blame Actions" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Blame actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Show Current Line Commit" }));
  expect(await screen.findByRole("dialog", { name: "Git Blame Details" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Git Blame Details" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Editor")).toHaveClass("editor-surface--active");
});
```

- [ ] **Step 2: Write failing save refresh test**

Add:

```ts
it("refreshes Git Blame after saving without blocking save", async () => {
  const user = userEvent.setup();
  const getFileBlame = vi.fn(async () => [
    {
      line: 1,
      commit: "aaa1111",
      sourceLine: 1,
      author: "Jane Doe",
      authoredAt: "2026-06-20T10:00:00Z",
      relativeTime: "4d ago",
      summary: "Add entry component",
    },
  ]);
  const saveFile = vi.fn(async () => undefined);
  const workspaceApi = createWorkspaceApi({
    openWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => "@Entry\nbuild() {}",
    saveFile,
    getFileBlame,
  });

  render(<AppShell workspaceApi={workspaceApi} />);

  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  await user.click(await screen.findByLabelText("Editor Content"));
  await user.keyboard("{End}\n// dirty");
  await user.keyboard("{Meta>}s{/Meta}");

  await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(getFileBlame).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Escape before broader|after saving"
```

Expected: FAIL because Escape/save refresh handling is incomplete.

- [ ] **Step 4: Update transient close priority**

At the top of `closeTransientUi()` in `AppShell.tsx`, add:

```ts
if (gitBlameMenuOpen) {
  setGitBlameMenuOpen(false);
  focusEditor();
  return true;
}
if (selectedBlameAttribution) {
  setSelectedBlameAttribution(null);
  focusEditor();
  return true;
}
```

- [ ] **Step 5: Refresh after save**

In `saveActiveDocument()`, after `documentsRef.current.saveDocument(activePath); syncTabs(); setEditorContent(content);`, add:

```ts
setGitBlameRefreshToken((token) => token + 1);
```

Do this before `setStatusText(...)`. Keep save completion independent from blame refresh failures because `useGitTrace` handles errors asynchronously.

- [ ] **Step 6: Run Escape/save tests**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx --testNamePattern "Escape before broader|after saving"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: refresh and dismiss git blame actions"
```

---

### Task 6: Verification

**Files:**
- Modify only plan-owned files if verification exposes defects.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/frontend/app-shell.test.tsx tests/frontend/editor.test.tsx tests/frontend/git-blame-buffer-mapper.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full frontend suite**

Run:

```bash
pnpm test
```

Expected: PASS. Existing non-fatal React `act(...)` warnings may appear.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run Tauri tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes:

```bash
git add <changed-plan-owned-files>
git commit -m "fix: stabilize git blame action loop"
```

If no fixes were needed, do not create an empty commit.

---

## Plan Self-Review

- Spec coverage: Covers command palette entries, status menu, card action split, Escape priority, save refresh, no Git blame reload per keystroke, and local diff behavior.
- Placeholder scan: No placeholder markers or open-ended instructions remain.
- Type consistency: Uses existing `GitBlameAttribution`, `gitBlameVisible`, `selectedBlameAttribution`, and introduces `gitBlameRefreshToken` consistently.
