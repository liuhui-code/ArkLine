# ArkLine Bottom Tool Window Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bottom tool window behave like a modern IDE panel: vertically resizable, hideable without losing state, and clear about panel hiding versus terminal session closing.

**Architecture:** `AppShell` owns bottom content expansion, active tool, expanded height, and a layout token. `BottomToolWindow` becomes a controlled view with an always-visible tool tab strip, collapsible content area, resize separator, tab toggle behavior, and a panel close button. `TerminalToolWindowHost` and `TerminalViewport` receive a layout token so xterm refits after panel resize or restore.

**Tech Stack:** React, TypeScript, Testing Library, Vitest, CSS grid, CodeMirror/xterm integration.

---

## File Structure

- Modify `src/components/layout/AppShell.tsx`: bottom content expansion state model, show/toggle/collapse/resize actions, layout token wiring.
- Modify `src/components/layout/BottomToolWindow.tsx`: always-visible tab strip, collapsible content area, resize handle, close button, tab toggle callback, height style, pointer event handling.
- Modify `src/components/layout/TerminalToolWindowHost.tsx`: accept `layoutToken` and pass it to `TerminalToolWindow`.
- Modify `src/components/layout/TerminalToolWindow.tsx`: accept `layoutToken` and pass it to `TerminalViewport`.
- Modify `src/components/layout/TerminalViewport.tsx`: accept `layoutToken` and run `fitAddon.fit()` when it changes.
- Modify `src/styles/app.css`: stable bottom panel height, resize handle, close button, content fill, Terminal/Git scroll behavior.
- Modify `tests/frontend/bottom-tool-window.test.tsx`: add bottom panel resize/toggle/close tests.
- Modify `tests/frontend/terminal-tool-window.test.tsx`: add Terminal layout token fit test or extend existing fake terminal coverage.
- Modify `tests/frontend/shell-hotkeys.test.tsx`: ensure `Shift+Escape` uses the same hide behavior.

## Task 1: Bottom Panel Toggle and Close Semantics

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/BottomToolWindow.tsx`
- Modify: `tests/frontend/bottom-tool-window.test.tsx`
- Modify: `tests/frontend/shell-hotkeys.test.tsx`

- [ ] **Step 1: Write failing tests for active-tab toggle and close button**

Add these tests to `tests/frontend/bottom-tool-window.test.tsx`:

```tsx
it("collapses and restores the bottom content when clicking the active tool tab", async () => {
  const user = userEvent.setup();
  render(<AppShell />);

  const terminalTab = screen.getByRole("tab", { name: "Terminal" });
  await user.click(terminalTab);
  expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
  expect(screen.getByLabelText("Terminal Panel")).toBeVisible();
  expect(terminalTab).toHaveAttribute("aria-selected", "true");

  await user.click(terminalTab);
  expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
  expect(screen.queryByLabelText("Terminal Panel")).not.toBeInTheDocument();
  expect(terminalTab).toHaveAttribute("aria-selected", "true");

  await user.click(terminalTab);
  expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
  expect(screen.getByLabelText("Terminal Panel")).toBeVisible();
});

it("collapses the bottom content from the panel close button without changing the active tool", async () => {
  const user = userEvent.setup();
  render(<AppShell />);

  await user.click(screen.getByRole("tab", { name: "Git" }));
  expect(screen.getByLabelText("Git Panel")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Hide Bottom Tool Window" }));

  expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
  expect(screen.queryByLabelText("Git Panel")).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");

  await user.click(screen.getByRole("tab", { name: "Git" }));
  expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
  expect(screen.getByLabelText("Git Panel")).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm exec vitest run tests/frontend/bottom-tool-window.test.tsx --reporter=dot
```

Expected: FAIL because clicking the active tab never collapses the content and the close button does not exist.

- [ ] **Step 3: Implement panel toggle actions in `AppShell`**

Rename the `bottomVisible` state in `src/components/layout/AppShell.tsx` to `bottomContentVisible`:

```tsx
  const [bottomContentVisible, setBottomContentVisible] = useState(true);
```

Replace the existing `showBottomTool` helper with these helpers:

```tsx
  function showBottomTool(tool: BottomToolKey) {
    setBottomContentVisible(true);
    setActiveBottomTool(tool);
    setStatusText(
      tool === "terminal" ? "Terminal"
      : tool === "git" ? "Git"
      : tool === "gitTrace" ? "Git Trace"
      : tool === "usages" ? "Usages"
      : "Problems",
    );
  }

  function toggleBottomTool(tool: BottomToolKey) {
    if (bottomContentVisible && activeBottomTool === tool) {
      hideBottomToolWindow();
      return;
    }

    showBottomTool(tool);
  }

  function hideBottomToolWindow() {
    setBottomContentVisible(false);
    setStatusText("Editor");
    focusEditorSoon();
  }
```

Update the `BottomToolWindow` call in `AppShell`:

```tsx
      <BottomToolWindow
        containerRef={bottomToolWindowRef}
        activeTool={activeBottomTool}
        onSelectTool={showBottomTool}
        onToggleTool={toggleBottomTool}
        onClose={hideBottomToolWindow}
        contentVisible={bottomContentVisible}
        problemsPanel={<ProblemsPanel problems={problems} />}
        terminalPanel={<TerminalToolWindowHost active={bottomContentVisible && activeBottomTool === "terminal"} onStatusChange={setStatusText} workspaceApi={workspaceApi} workspaceRootPath={workspace?.rootPath ?? null} />}
        gitPanel={<GitToolWindow files={diffFiles} onOpenFile={(path) => void openFile(path)} />}
        gitTracePanel={<GitTracePanel state={gitTraceState} onOpenInEditor={focusEditorSoon} onOpenCommitDiff={openGitTraceCommitDiff} />}
        usagesPanel={<UsagesPanel state={usageSearch} onOpenUsage={openUsageResult} />}
      />
```

Update `hideActiveToolWindow()` so its bottom tool path uses `hideBottomToolWindow`:

```tsx
    const focusTargets = [
      [bottomContentVisible, bottomToolWindowRef.current, hideBottomToolWindow],
      [filesVisible, filesPaneRef.current, () => setFilesVisible(false)],
    ] as const;
```

- [ ] **Step 4: Add props and close button to `BottomToolWindow`**

Update `src/components/layout/BottomToolWindow.tsx` props:

```tsx
type BottomToolWindowProps = {
  activeTool: BottomToolKey;
  onSelectTool: (tool: BottomToolKey) => void;
  onToggleTool: (tool: BottomToolKey) => void;
  onClose: () => void;
  contentVisible?: boolean;
  containerRef?: RefObject<HTMLElement | null>;
  problemsPanel: ReactNode;
  terminalPanel: ReactNode;
  gitPanel: ReactNode;
  gitTracePanel: ReactNode;
  usagesPanel: ReactNode;
};
```

Update the component signature to include `onToggleTool`, `onClose`, and `contentVisible = true`, then replace the tab strip with:

```tsx
    <section
      aria-label="Bottom Tool Window"
      className="bottom-tool-window"
      data-collapsed={contentVisible ? "false" : "true"}
      ref={containerRef}
    >
      <div className="bottom-tool-window__chrome">
        <div className="bottom-tool-window__tabs" role="tablist" aria-label="Bottom Tool Window Tabs">
          {tabOrder.map((tool) => (
            <button
              key={tool}
              id={`bottom-tool-tab-${tool}`}
              type="button"
              role="tab"
              aria-selected={activeTool === tool}
              aria-controls={`bottom-tool-panel-${tool}`}
              className={`bottom-tool-window__tab${activeTool === tool ? " bottom-tool-window__tab--active" : ""}`}
              onClick={() => onToggleTool(tool)}
            >
              {tabLabels[tool]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="bottom-tool-window__close"
          aria-label="Hide Bottom Tool Window"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {contentVisible ? (
        <div className="bottom-tool-window__content">
          {activeTool === "problems" ? (
            <div id="bottom-tool-panel-problems" role="tabpanel" aria-labelledby="bottom-tool-tab-problems">
              {problemsPanel}
            </div>
          ) : null}
          {activeTool === "terminal" ? (
            <div id="bottom-tool-panel-terminal" role="tabpanel" aria-labelledby="bottom-tool-tab-terminal">
              {terminalPanel}
            </div>
          ) : null}
          {activeTool === "git" ? (
            <div id="bottom-tool-panel-git" role="tabpanel" aria-labelledby="bottom-tool-tab-git">
              {gitPanel}
            </div>
          ) : null}
          {activeTool === "gitTrace" ? (
            <div id="bottom-tool-panel-gitTrace" role="tabpanel" aria-labelledby="bottom-tool-tab-gitTrace">
              {gitTracePanel}
            </div>
          ) : null}
          {activeTool === "usages" ? (
            <div id="bottom-tool-panel-usages" role="tabpanel" aria-labelledby="bottom-tool-tab-usages">
              {usagesPanel}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
```

- [ ] **Step 5: Add minimal CSS for the chrome and close button**

In `src/styles/app.css`, update the bottom tool tab CSS:

```css
.bottom-tool-window__chrome {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 29px;
  border-bottom: 1px solid var(--border-subtle);
  background: #303238;
}

.bottom-tool-window__tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 29px;
  padding: 0 var(--space-2);
}

.bottom-tool-window__close {
  width: 28px;
  height: 26px;
  margin-right: 4px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
}

.bottom-tool-window__close:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-primary);
}
```

- [ ] **Step 6: Update the Shift+Escape expectation**

In `tests/frontend/shell-hotkeys.test.tsx`, update the bottom tool window hotkey test so it expects the tab strip to remain visible and the active content to collapse:

```tsx
    await user.keyboard("{Shift>}{Escape}{/Shift}");

    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.queryByLabelText("Terminal Panel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Editor Content")).toHaveFocus();
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
pnpm exec vitest run tests/frontend/bottom-tool-window.test.tsx tests/frontend/shell-hotkeys.test.tsx --reporter=dot
```

Expected: PASS.

Commit:

```bash
git add src/components/layout/AppShell.tsx src/components/layout/BottomToolWindow.tsx src/styles/app.css tests/frontend/bottom-tool-window.test.tsx tests/frontend/shell-hotkeys.test.tsx
git commit -m "feat: clarify bottom tool window close behavior"
```

## Task 2: Resizable Bottom Panel Height

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/BottomToolWindow.tsx`
- Modify: `src/styles/app.css`
- Modify: `tests/frontend/bottom-tool-window.test.tsx`

- [ ] **Step 1: Write failing resize tests**

Add these tests to `tests/frontend/bottom-tool-window.test.tsx`:

```tsx
it("resizes the bottom panel by dragging the resize separator", async () => {
  render(<AppShell />);

  const bottomPanel = screen.getByLabelText("Bottom Tool Window");
  const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

  expect(bottomPanel).toHaveStyle({ height: "280px" });

  fireEvent.pointerDown(separator, { pointerId: 1, clientY: 500 });
  fireEvent.pointerMove(window, { pointerId: 1, clientY: 420 });
  fireEvent.pointerUp(window, { pointerId: 1, clientY: 420 });

  expect(bottomPanel).toHaveStyle({ height: "360px" });
});

it("clamps bottom panel resize height to min and max bounds", async () => {
  render(<AppShell />);

  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });

  const bottomPanel = screen.getByLabelText("Bottom Tool Window");
  const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

  fireEvent.pointerDown(separator, { pointerId: 1, clientY: 500 });
  fireEvent.pointerMove(window, { pointerId: 1, clientY: 800 });
  fireEvent.pointerUp(window, { pointerId: 1, clientY: 800 });
  expect(bottomPanel).toHaveStyle({ height: "160px" });

  fireEvent.pointerDown(separator, { pointerId: 2, clientY: 500 });
  fireEvent.pointerMove(window, { pointerId: 2, clientY: 0 });
  fireEvent.pointerUp(window, { pointerId: 2, clientY: 0 });
  expect(bottomPanel).toHaveStyle({ height: "560px" });
});

it("toggles between default and maximum height when double-clicking the resize separator", async () => {
  render(<AppShell />);

  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });

  const bottomPanel = screen.getByLabelText("Bottom Tool Window");
  const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

  fireEvent.doubleClick(separator);
  expect(bottomPanel).toHaveStyle({ height: "560px" });

  fireEvent.doubleClick(separator);
  expect(bottomPanel).toHaveStyle({ height: "280px" });
});
```

Update the import line in `tests/frontend/bottom-tool-window.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
```

- [ ] **Step 2: Run resize tests to verify failure**

Run:

```bash
pnpm exec vitest run tests/frontend/bottom-tool-window.test.tsx --reporter=dot
```

Expected: FAIL because resize separator and height state do not exist.

- [ ] **Step 3: Add height state and clamp helpers to `AppShell`**

Near the other state hooks in `src/components/layout/AppShell.tsx`, add:

```tsx
  const [bottomToolHeight, setBottomToolHeight] = useState(280);
  const [bottomLayoutToken, setBottomLayoutToken] = useState(0);
```

Add helpers near the bottom tool helpers:

```tsx
  function maxBottomToolHeight() {
    return Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.7);
  }

  function clampBottomToolHeight(height: number) {
    return Math.max(160, Math.min(maxBottomToolHeight(), Math.round(height)));
  }

  function resizeBottomToolWindow(height: number) {
    setBottomToolHeight(clampBottomToolHeight(height));
    setBottomLayoutToken((token) => token + 1);
  }

  function toggleBottomToolMaxHeight() {
    const maxHeight = maxBottomToolHeight();
    const nextHeight = Math.abs(bottomToolHeight - maxHeight) <= 2 ? 280 : maxHeight;
    resizeBottomToolWindow(nextHeight);
  }
```

Update `showBottomTool` to notify layout after restore:

```tsx
  function showBottomTool(tool: BottomToolKey) {
    setBottomContentVisible(true);
    setActiveBottomTool(tool);
    setBottomLayoutToken((token) => token + 1);
    setStatusText(
      tool === "terminal" ? "Terminal"
      : tool === "git" ? "Git"
      : tool === "gitTrace" ? "Git Trace"
      : tool === "usages" ? "Usages"
      : "Problems",
    );
  }
```

Pass height and resize props to `BottomToolWindow`:

```tsx
        height={bottomToolHeight}
        onResizeHeight={resizeBottomToolWindow}
        onToggleMaxHeight={toggleBottomToolMaxHeight}
```

- [ ] **Step 4: Implement resize handle in `BottomToolWindow`**

Update props in `src/components/layout/BottomToolWindow.tsx`:

```tsx
  height: number;
  onResizeHeight: (height: number) => void;
  onToggleMaxHeight: () => void;
```

Import `useRef`:

```tsx
import { type PointerEvent, type ReactNode, type RefObject, useRef } from "react";
```

Inside `BottomToolWindow`, before `return`, add:

```tsx
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  function handleResizePointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeStartRef.current = { y: event.clientY, height };

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }

      onResizeHeight(start.height + start.y - moveEvent.clientY);
    }

    function handlePointerUp() {
      resizeStartRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }
```

Update the root section:

```tsx
    <section
      aria-label="Bottom Tool Window"
      className="bottom-tool-window"
      data-collapsed={contentVisible ? "false" : "true"}
      ref={containerRef}
      style={{ height: contentVisible ? `${height}px` : "29px" }}
    >
```

Add the resize separator as the first child:

```tsx
      {contentVisible ? <div
        aria-label="Resize Bottom Tool Window"
        aria-orientation="horizontal"
        className="bottom-tool-window__resize-handle"
        role="separator"
        onDoubleClick={onToggleMaxHeight}
        onPointerDown={handleResizePointerDown}
      /> : null}
```

- [ ] **Step 5: Add height and resize CSS**

In `src/styles/app.css`, update:

```css
.bottom-tool-window {
  display: grid;
  grid-template-rows: 7px 29px minmax(0, 1fr);
  max-height: 70vh;
  border-top: 1px solid var(--border-subtle);
}

.bottom-tool-window[data-collapsed="true"] {
  grid-template-rows: 29px;
}

.bottom-tool-window__resize-handle {
  cursor: ns-resize;
  background: #25272c;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.bottom-tool-window__resize-handle:hover {
  background: #3a3d45;
}
```

Update content fill:

```css
.bottom-tool-window__content {
  min-height: 0;
  overflow: hidden;
  padding: var(--space-2);
  background: #2a2c31;
}

.bottom-tool-window__content > div[role="tabpanel"],
.bottom-tool-window__panel {
  height: 100%;
  min-height: 0;
}
```

- [ ] **Step 6: Run resize tests and commit**

Run:

```bash
pnpm exec vitest run tests/frontend/bottom-tool-window.test.tsx --reporter=dot
```

Expected: PASS.

Commit:

```bash
git add src/components/layout/AppShell.tsx src/components/layout/BottomToolWindow.tsx src/styles/app.css tests/frontend/bottom-tool-window.test.tsx
git commit -m "feat: resize bottom tool window"
```

## Task 3: Terminal Fit on Bottom Panel Layout Changes

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/TerminalToolWindowHost.tsx`
- Modify: `src/components/layout/TerminalToolWindow.tsx`
- Modify: `src/components/layout/TerminalViewport.tsx`
- Modify: `tests/frontend/terminal-tool-window.test.tsx`

- [ ] **Step 1: Write failing terminal layout-token test**

In `tests/frontend/terminal-tool-window.test.tsx`, add this test in the terminal viewport or terminal tool window section that already mocks xterm:

```tsx
it("refits xterm when the terminal layout token changes", async () => {
  const { rerender } = render(
    <TerminalViewport
      focusToken={0}
      layoutToken={1}
      onInput={() => undefined}
      sessionId="session-1"
    />,
  );

  await waitFor(() => expect(terminalInstances).toHaveLength(1));
  const initialFitCount = fitAddonFit.mock.calls.length;

  await act(async () => {
    rerender(
      <TerminalViewport
        focusToken={0}
        layoutToken={2}
        onInput={() => undefined}
        sessionId="session-1"
      />,
    );
  });

  expect(fitAddonFit.mock.calls.length).toBeGreaterThan(initialFitCount);
});
```

Update the existing `TerminalViewport` renders in this test file to pass `layoutToken={0}` until the new prop is wired.

- [ ] **Step 2: Run terminal test to verify failure**

Run:

```bash
pnpm exec vitest run tests/frontend/terminal-tool-window.test.tsx --reporter=dot
```

Expected: FAIL because `TerminalToolWindowHost` does not accept `layoutToken` and `TerminalViewport` does not refit on it.

- [ ] **Step 3: Thread `layoutToken` through Terminal components**

Update `src/components/layout/TerminalToolWindowHost.tsx` props:

```tsx
type TerminalToolWindowHostProps = {
  active: boolean;
  layoutToken: number;
  onStatusChange: (status: string) => void;
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
};
```

Destructure `layoutToken`, then pass it to `TerminalToolWindow`:

```tsx
      layoutToken={layoutToken}
```

Update the `useMemo` dependency list to include `layoutToken`.

Update `src/components/layout/TerminalToolWindow.tsx` props:

```tsx
  layoutToken: number;
```

Pass it to `TerminalViewport`:

```tsx
        <TerminalViewport ref={viewportRef} focusToken={focusToken} layoutToken={layoutToken} sessionId={activeSessionId} onInput={onInput} />
```

Update `src/components/layout/TerminalViewport.tsx` props:

```tsx
  layoutToken: number;
```

Destructure `layoutToken`, then add:

```tsx
  useEffect(() => {
    if (xtermEnabled && terminalRef.current) {
      fitAddonRef.current?.fit();
    }
  }, [layoutToken, xtermEnabled]);
```

Update every existing `TerminalViewport` render in `tests/frontend/terminal-tool-window.test.tsx` so the new required prop is present:

```tsx
<TerminalViewport
  ref={viewportRef}
  focusToken={0}
  layoutToken={0}
  onInput={() => undefined}
  sessionId="session-1"
/>
```

- [ ] **Step 4: Pass layout token from `AppShell`**

Update the Terminal panel in `src/components/layout/AppShell.tsx`:

```tsx
        terminalPanel={<TerminalToolWindowHost active={bottomContentVisible && activeBottomTool === "terminal"} layoutToken={bottomLayoutToken} onStatusChange={setStatusText} workspaceApi={workspaceApi} workspaceRootPath={workspace?.rootPath ?? null} />}
```

- [ ] **Step 5: Run terminal tests and commit**

Run:

```bash
pnpm exec vitest run tests/frontend/terminal-tool-window.test.tsx tests/frontend/bottom-tool-window.test.tsx --reporter=dot
```

Expected: PASS.

Commit:

```bash
git add src/components/layout/AppShell.tsx src/components/layout/TerminalToolWindowHost.tsx src/components/layout/TerminalToolWindow.tsx src/components/layout/TerminalViewport.tsx tests/frontend/terminal-tool-window.test.tsx
git commit -m "fix: refit terminal on bottom panel resize"
```

## Task 4: Git and Panel Content Fill Behavior

**Files:**
- Modify: `src/styles/app.css`
- Modify: `tests/frontend/bottom-tool-window.test.tsx`
- Modify: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write layout regression test for Git after resize**

Add this test to `tests/frontend/bottom-tool-window.test.tsx`:

```tsx
it("keeps Git content inside the resized bottom panel", async () => {
  const user = userEvent.setup();
  render(<AppShell />);

  await user.click(screen.getByRole("tab", { name: "Git" }));
  const bottomPanel = screen.getByLabelText("Bottom Tool Window");
  const gitPanel = screen.getByLabelText("Git Panel");
  const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

  fireEvent.pointerDown(separator, { pointerId: 1, clientY: 500 });
  fireEvent.pointerMove(window, { pointerId: 1, clientY: 450 });
  fireEvent.pointerUp(window, { pointerId: 1, clientY: 450 });

  expect(bottomPanel).toHaveStyle({ height: "330px" });
  expect(gitPanel).toBeVisible();
});
```

- [ ] **Step 2: Run layout regression test**

Run:

```bash
pnpm exec vitest run tests/frontend/bottom-tool-window.test.tsx --reporter=dot
```

Expected: PASS after Task 2. Continue to Step 3 to make the fill rules explicit even if the test already passes.

- [ ] **Step 3: Tighten CSS fill rules**

In `src/styles/app.css`, ensure these rules exist:

```css
.git-tool-window {
  display: grid;
  grid-template-columns: minmax(220px, 280px) 1fr;
  gap: var(--space-2);
  height: 100%;
  min-height: 0;
}

.git-tool-window__sidebar,
.git-tool-window__viewer {
  min-height: 0;
  overflow: auto;
}

.terminal-tool-window__viewport {
  min-height: 0;
  outline: none;
  background: #1e1f22;
}
```

- [ ] **Step 4: Run frontend panel tests and commit**

Run:

```bash
pnpm exec vitest run tests/frontend/bottom-tool-window.test.tsx tests/frontend/app-shell.test.tsx --testNamePattern "Terminal|Git|bottom|tool window|settings" --reporter=dot
```

Expected: PASS.

Commit:

```bash
git add src/styles/app.css tests/frontend/bottom-tool-window.test.tsx tests/frontend/app-shell.test.tsx
git commit -m "fix: keep bottom tool content within resizable panel"
```

## Task 5: Full Verification

**Files:**
- No planned source changes.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run tests/frontend/bottom-tool-window.test.tsx tests/frontend/shell-hotkeys.test.tsx tests/frontend/terminal-tool-window.test.tsx --reporter=dot
```

Expected: PASS.

- [ ] **Step 2: Run full frontend and worker tests**

Run:

```bash
pnpm test
```

Expected: PASS. Existing non-failing React `act(...)` and jsdom canvas warnings may appear.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 5: Inspect final diff and status**

Run:

```bash
git status --short
```

Expected: only unrelated pre-existing dirty files remain, or no unstaged files from this plan.

If any plan-owned file remains modified, stage and commit it:

```bash
git add src/components/layout/AppShell.tsx src/components/layout/BottomToolWindow.tsx src/components/layout/TerminalToolWindowHost.tsx src/components/layout/TerminalToolWindow.tsx src/components/layout/TerminalViewport.tsx src/styles/app.css tests/frontend/bottom-tool-window.test.tsx tests/frontend/shell-hotkeys.test.tsx tests/frontend/terminal-tool-window.test.tsx tests/frontend/app-shell.test.tsx
git commit -m "test: verify resizable bottom tool window"
```

## Self-Review

Spec coverage:

- Resizable bottom height: Task 2.
- Two-level closure: Task 1.
- Active tab toggle: Task 1.
- `Shift+Escape` collapse path: Task 1 and Task 5 focused tests.
- Terminal state preservation and xterm fit: Task 3.
- Git/internal scrolling: Task 4.
- Accessibility labels and separator role: Task 2.
- In-memory height only: Task 2 state is local to `AppShell`.

Placeholder scan: no TBD/TODO placeholders are present.

Type consistency: `bottomContentVisible`, `bottomToolHeight`, `bottomLayoutToken`, `onResizeHeight`, `onToggleMaxHeight`, `layoutToken`, and `hideBottomToolWindow` are used consistently across tasks.
