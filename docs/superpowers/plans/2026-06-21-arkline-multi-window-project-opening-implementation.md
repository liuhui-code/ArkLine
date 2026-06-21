# ArkLine Multi-Window Project Opening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ArkLine open additional projects like IDEA: reuse an empty window, but ask `This Window / New Window / Cancel` when a workspace is already loaded, with the same flow for recent projects.

**Architecture:** Add one shared frontend project-opening decision flow in `AppShell`, backed by a compact modal dialog and a typed workspace API command for opening a project in a new Tauri window. New windows receive a launch workspace path from Rust during bootstrap and auto-open that workspace on first render.

**Tech Stack:** React, TypeScript, Vitest, Tauri v2, Rust

---

### Task 1: Add frontend API coverage for multi-window project opening

**Files:**
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add a new test in `tests/frontend/app-shell.test.tsx` that renders `AppShell` with a mocked `workspaceApi`, opens one workspace, attempts to open a second project, chooses `New Window`, and asserts that `openWorkspaceInNewWindow` is called while the current workspace label remains unchanged.

```tsx
  it("opens a second project in a new window when the current window is already occupied", async () => {
    const user = userEvent.setup();
    const openWorkspaceInNewWindow = vi.fn(async () => undefined);

    render(
      <AppShell
        workspaceApi={createWorkspaceApi({
          openWorkspaceInNewWindow,
        })}
      />,
    );

    await openProject(user, "C:/samples/DemoWorkspace");
    expect(screen.getByText("Workspace: DemoWorkspace")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    await user.click(await screen.findByRole("button", { name: "New Window" }));

    expect(openWorkspaceInNewWindow).toHaveBeenCalledWith("C:/samples/ArkDemo");
    expect(screen.getByText("Workspace: DemoWorkspace")).toBeVisible();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: FAIL because `WorkspaceApi` has no `openWorkspaceInNewWindow` contract and the dialog flow does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Extend `WorkspaceApi` in `src/features/workspace/workspace-api.ts` with:

```ts
export type WorkspaceLaunchContext = {
  rootPath: string | null;
};
```

and:

```ts
  openWorkspaceInNewWindow(rootPath: string): Promise<void>;
  getLaunchWorkspacePath(): Promise<string | null>;
```

Implement the default behavior as:

```ts
  async openWorkspaceInNewWindow(rootPath) {
    if (hasTauriRuntime()) {
      await invoke("open_workspace_in_new_window", { rootPath });
      return;
    }

    void rootPath;
  },
  async getLaunchWorkspacePath() {
    if (hasTauriRuntime()) {
      return invoke<string | null>("get_launch_workspace_path");
    }

    return null;
  },
```

Also update any local test helper `createWorkspaceApi(...)` factories to include:

```ts
    openWorkspaceInNewWindow: async () => undefined,
    getLaunchWorkspacePath: async () => null,
```

- [ ] **Step 4: Run test to verify it passes or fails for the next missing behavior**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: FAIL later in the new test because the dialog and decision flow still do not exist, but TypeScript/test wiring now compiles.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/workspace-api.ts tests/frontend/app-shell.test.tsx
git commit -m "feat: add multi-window workspace api contract"
```

### Task 2: Add the project-open decision dialog and shared frontend decision flow

**Files:**
- Create: `src/components/layout/OpenProjectDecisionDialog.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/frontend/app-shell.test.tsx`:

```tsx
  it("opens a project directly in the current window when no workspace is loaded", async () => {
    const user = userEvent.setup();
    const openWorkspace = vi.fn(async (rootPath: string) => ({
      rootName: rootPath.split("/").at(-1) ?? "Workspace",
      rootPath,
      files: [`${rootPath}/src/main.ets`],
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ openWorkspace })} />);

    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));

    expect(screen.queryByRole("dialog", { name: "Open Project Decision" })).not.toBeInTheDocument();
    expect(openWorkspace).toHaveBeenCalledWith("C:/samples/ArkDemo");
  });

  it("asks whether to use this window or a new window when a workspace is already loaded", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.clear(await screen.findByLabelText("Project Path"));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));

    expect(await screen.findByRole("dialog", { name: "Open Project Decision" })).toBeVisible();
    expect(screen.getByRole("button", { name: "This Window" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New Window" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  it("keeps the current workspace unchanged when project-open decision is cancelled", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.clear(await screen.findByLabelText("Project Path"));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Workspace: DemoWorkspace")).toBeVisible();
    expect(await screen.findByRole("button", { name: "main.ets", pressed: true })).toBeVisible();
  });

  it("replaces the current workspace when This Window is selected", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.clear(await screen.findByLabelText("Project Path"));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    await user.click(await screen.findByRole("button", { name: "This Window" }));

    expect(await screen.findByText("Workspace: ArkDemo")).toBeVisible();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: FAIL because there is no decision dialog, no shared decision flow, and current behavior always replaces the current workspace.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/layout/OpenProjectDecisionDialog.tsx`:

```tsx
type OpenProjectDecisionDialogProps = {
  open: boolean;
  projectName: string;
  onChooseThisWindow: () => void;
  onChooseNewWindow: () => void;
  onCancel: () => void;
};

export function OpenProjectDecisionDialog({
  open,
  projectName,
  onChooseThisWindow,
  onChooseNewWindow,
  onCancel,
}: OpenProjectDecisionDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <section className="settings-dialog" aria-label="Open Project Decision" role="dialog" aria-modal="true">
      <div className="settings-dialog__header">
        <h2>Open Project</h2>
      </div>
      <div className="settings-dialog__body">
        <p>{`Open "${projectName}" in this window or a new window?`}</p>
      </div>
      <div className="settings-dialog__actions">
        <button type="button" className="settings-dialog__button" onClick={onChooseThisWindow}>This Window</button>
        <button type="button" className="settings-dialog__button settings-dialog__button--primary" onClick={onChooseNewWindow}>New Window</button>
        <button type="button" className="settings-dialog__button settings-dialog__button--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}
```

In `AppShell.tsx` add:

- state for pending path and decision-dialog visibility
- a shared function:

```ts
  async function requestProjectOpen(rootPath: string) {
    if (!workspace) {
      await openWorkspace(rootPath);
      return;
    }

    setPendingProjectPath(rootPath);
    setProjectDecisionVisible(true);
  }
```

- use `requestProjectOpen(rootPath)` from:
  - native picker completion
  - typed-path confirmation
  - recent projects overlay

- decision handlers:

```ts
  async function openPendingProjectInThisWindow() {
    const rootPath = pendingProjectPath;
    setProjectDecisionVisible(false);
    setPendingProjectPath(null);
    if (rootPath) {
      await openWorkspace(rootPath);
    }
  }

  async function openPendingProjectInNewWindow() {
    const rootPath = pendingProjectPath;
    setProjectDecisionVisible(false);
    setPendingProjectPath(null);
    if (!rootPath) {
      return;
    }
    await workspaceApi.openWorkspaceInNewWindow(rootPath);
    setStatusText(`Opened ${getPathBasename(rootPath)} in a new window`);
  }

  function cancelPendingProjectOpen() {
    setProjectDecisionVisible(false);
    setPendingProjectPath(null);
    focusEditorSoon();
  }
```

Render:

```tsx
      <OpenProjectDecisionDialog
        open={projectDecisionVisible}
        projectName={getPathBasename(pendingProjectPath ?? "") || "Project"}
        onChooseThisWindow={() => void openPendingProjectInThisWindow()}
        onChooseNewWindow={() => void openPendingProjectInNewWindow()}
        onCancel={cancelPendingProjectOpen}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: PASS for the new project-decision tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/OpenProjectDecisionDialog.tsx src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: add project-open decision dialog"
```

### Task 3: Route recent-project selection through the same decision flow

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test:

```tsx
  it("asks for this window or new window when reopening a recent project from an occupied window", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await openProject(user, "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Recent Projects" }));
    await user.click(await screen.findByRole("button", { name: "DemoWorkspace" }));

    expect(await screen.findByRole("dialog", { name: "Open Project Decision" })).toBeVisible();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: FAIL if recent-project clicks still bypass the shared decision flow.

- [ ] **Step 3: Write minimal implementation**

Ensure every project-opening path in `AppShell.tsx` uses `requestProjectOpen(...)` rather than calling `openWorkspace(...)` directly, including:

```tsx
        <SearchOverlayContent
          ...
          onOpenProject={(path) => void requestProjectOpen(path)}
          ...
        />
```

and any command-palette action that opens a project path.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: unify recent project opening flow"
```

### Task 4: Add Tauri commands for opening a workspace in a new window and reading launch context

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/commands/windowing.rs`
- Test: `src-tauri/src/commands/windowing.rs`

- [ ] **Step 1: Write the failing Rust test**

Create a focused unit test in `src-tauri/src/commands/windowing.rs` for helper functions:

```rust
#[cfg(test)]
mod tests {
    use super::{sanitize_window_label, LaunchWorkspaceState};

    #[test]
    fn sanitizes_window_label_from_workspace_path() {
        assert!(sanitize_window_label("C:/samples/ArkDemo").starts_with("workspace-"));
    }

    #[test]
    fn stores_and_reads_launch_workspace_path() {
        let state = LaunchWorkspaceState::default();
        state.set_for_label("workspace-1", "C:/samples/ArkDemo".to_string());
        assert_eq!(state.take_for_label("workspace-1"), Some("C:/samples/ArkDemo".to_string()));
    }
}
```

- [ ] **Step 2: Run Rust test to verify it fails**

Run: `cargo test windowing`

Expected: FAIL because the command module and helper state do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src-tauri/src/commands/windowing.rs` with:

```rust
use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct LaunchWorkspaceState {
    paths: Mutex<HashMap<String, String>>,
}

impl LaunchWorkspaceState {
    pub fn set_for_label(&self, label: &str, root_path: String) {
        self.paths.lock().expect("launch workspace lock").insert(label.to_string(), root_path);
    }

    pub fn take_for_label(&self, label: &str) -> Option<String> {
        self.paths.lock().expect("launch workspace lock").remove(label)
    }
}

pub fn sanitize_window_label(root_path: &str) -> String {
    let sanitized = root_path
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    format!("workspace-{sanitized}")
}

#[tauri::command]
pub fn open_workspace_in_new_window(
    app: AppHandle,
    launch_state: State<LaunchWorkspaceState>,
    root_path: String,
) -> Result<(), String> {
    let label = format!("{}-{}", sanitize_window_label(&root_path), uuid::Uuid::new_v4());
    launch_state.set_for_label(&label, root_path.clone());
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("ArkLine")
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_launch_workspace_path(
    window: tauri::Window,
    launch_state: State<LaunchWorkspaceState>,
) -> Result<Option<String>, String> {
    Ok(launch_state.take_for_label(window.label()))
}
```

Update `src-tauri/src/lib.rs`:

```rust
mod commands {
    pub mod documents;
    pub mod environment;
    pub mod language;
    pub mod settings;
    pub mod terminal;
    pub mod windowing;
    pub mod workspace;
}
```

and:

```rust
        .manage(commands::windowing::LaunchWorkspaceState::default())
```

and add both commands to `generate_handler!`.

Also add the Rust dependency in `src-tauri/Cargo.toml`:

```toml
uuid = { version = "1", features = ["v4"] }
```

- [ ] **Step 4: Run Rust test to verify it passes**

Run: `cargo test windowing`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/commands/windowing.rs
git commit -m "feat: add multi-window workspace commands"
```

### Task 5: Auto-open launch workspace path in newly created windows

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test:

```tsx
  it("auto-opens the launch workspace path when the window boots with one", async () => {
    render(
      <AppShell
        workspaceApi={createWorkspaceApi({
          getLaunchWorkspacePath: async () => "C:/samples/ArkDemo",
        })}
      />,
    );

    expect(await screen.findByText("Workspace: ArkDemo")).toBeVisible();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: FAIL because AppShell does not read launch workspace context during boot.

- [ ] **Step 3: Write minimal implementation**

In `AppShell.tsx`, add a boot-time effect:

```ts
  useEffect(() => {
    let disposed = false;

    void (async () => {
      const rootPath = await workspaceApi.getLaunchWorkspacePath();
      if (!rootPath || disposed) {
        return;
      }
      await openWorkspace(rootPath);
    })();

    return () => {
      disposed = true;
    };
  }, [workspaceApi]);
```

Guard it so it only auto-opens if `workspace` is still null at boot time.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/frontend/app-shell.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx tests/frontend/app-shell.test.tsx
git commit -m "feat: auto-open launch workspace on new windows"
```

### Task 6: Verify the flow, update logs, and keep the codebase honest

**Files:**
- Modify: `gitlog.md`
- Modify: `tests/frontend/shell-hotkeys.test.tsx` (only if needed for focus-return coverage)

- [ ] **Step 1: Write the final regression coverage if missing**

If focus-return after `Cancel` is not already covered, add:

```tsx
  it("returns focus to the editor after cancelling the project-open decision", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.clear(await screen.findByLabelText("Project Path"));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByLabelText("Editor Content")).toHaveFocus();
  });
```

- [ ] **Step 2: Run the related test suite**

Run: `pnpm test tests/frontend/app-shell.test.tsx tests/frontend/shell-hotkeys.test.tsx`

Expected: PASS.

Run: `cargo test windowing`

Expected: PASS.

- [ ] **Step 3: Update project log**

Append to `gitlog.md`:

```md
- 2026-06-21: Aligned project opening with IDEA-style multi-window behavior by reusing empty windows, prompting for `This Window / New Window / Cancel` when occupied, routing recent projects through the same decision flow, and teaching new windows to auto-open their launch workspace path.
```

- [ ] **Step 4: Run final verification**

Run: `pnpm test`

Expected: PASS

Run: `cargo test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppShell.tsx src/components/layout/OpenProjectDecisionDialog.tsx src/features/workspace/workspace-api.ts src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/src/commands/windowing.rs tests/frontend/app-shell.test.tsx tests/frontend/shell-hotkeys.test.tsx gitlog.md
git commit -m "feat: add idea-style multi-window project opening"
```
