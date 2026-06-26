import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { AppShell } from "@/components/layout/AppShell";
import type { LanguageCompletionItem, WorkspaceApi } from "@/features/workspace/workspace-api";
import { defaultSettings } from "@/features/settings/settings-store";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { vi } from "vitest";

async function openProject(
  user: ReturnType<typeof userEvent.setup>,
  path = "C:/samples/DemoWorkspace",
  decision: "This Window" | "New Window" | "Cancel" | null = "This Window",
) {
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
  await user.clear(await screen.findByLabelText("Project Path"));
  await user.type(screen.getByLabelText("Project Path"), path);
  await user.click(screen.getByRole("button", { name: "Open Project" }));
  if (decision) {
    const decisionButton = screen.queryByRole("button", { name: decision });
    if (decisionButton) {
      await user.click(decisionButton);
    }
  }
}

async function openMainEditor(user: ReturnType<typeof userEvent.setup>) {
  await openProject(user);
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  const editor = await screen.findByLabelText("Editor Content");
  await user.click(editor);
  return editor;
}

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    pickWorkspaceRoot: async () => null,
    pickPath: async () => null,
    openWorkspace: async (rootPath: string) => ({
      rootName: rootPath.split("/").at(-1) ?? "Workspace",
      rootPath,
      files: [`${rootPath}/src/main.ets`, `${rootPath}/AppScope/app.json5`],
    }),
    openDemoWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets", "C:/samples/DemoWorkspace/AppScope/app.json5"],
    }),
    openFile: async (path: string) => path.endsWith("app.json5")
      ? "{\n  \"app\": {\n    \"bundleName\": \"com.demo.app\"\n  }\n}"
      : "@Entry\n@Component\nstruct Index {}",
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => ({ tools: [] }),
    getFileBlame: async () => ({
      kind: "unavailable",
      reason: "notTracked",
      message: "File is not tracked by Git",
    }),
    getCommitTrace: async () => ({
      kind: "unavailable",
      reason: "detailUnavailable",
      message: "Commit details unavailable",
    }),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
    createTerminalSession: async () => ({
      id: "session-1",
      title: "pwsh",
      cwd: "C:/samples/DemoWorkspace",
      shell: "pwsh",
      status: "idle",
    }),
    listTerminalSessions: async () => [],
    writeTerminalInput: async () => undefined,
    resizeTerminalSession: async () => undefined,
    closeTerminalSession: async () => undefined,
    stopTerminalSession: async () => undefined,
    runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
    stopTerminalCommand: async () => undefined,
    ...overrides,
    listDeviceLogDevices: async () => [],
    startDeviceLogStream: async (request) => ({ streamId: "stream-1", deviceId: request.deviceId, status: "running" }),
    stopDeviceLogStream: async () => undefined,
  };
}

function mockEditorCaretRect(rect: { top: number; left: number; bottom: number; right: number } | null) {
  return vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue(rect);
}

function mockViewportSize(width: number, height: number) {
  const widthDescriptor = Object.getOwnPropertyDescriptor(window, "innerWidth");
  const heightDescriptor = Object.getOwnPropertyDescriptor(window, "innerHeight");

  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });

  return () => {
    if (widthDescriptor) {
      Object.defineProperty(window, "innerWidth", widthDescriptor);
    }
    if (heightDescriptor) {
      Object.defineProperty(window, "innerHeight", heightDescriptor);
    }
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("App shell", () => {
  it("renders the approved shell regions", async () => {
    render(<App />);

    expect(screen.getByLabelText("Editor")).toHaveClass("editor-surface--empty");
    expect(screen.getByRole("banner", { name: "Application Header" })).toBeInTheDocument();
    expect(screen.getByLabelText("Primary Tool Window Rail")).toBeInTheDocument();
    expect(screen.getByLabelText("Bottom Tool Window")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Welcome" })).toHaveClass("editor-tab--placeholder");
    expect(screen.getByText("Welcome", { selector: ".workspace-empty__title" })).toHaveClass("workspace-empty__title");
    expect(screen.getByText("Open a HarmonyOS workspace to start reviewing and editing ArkTS files.")).toHaveClass(
      "workspace-empty__description",
    );
    expect(await screen.findByLabelText("Semantic Mode")).toHaveTextContent("Fallback");
  });

  it("renders the primary IDE regions", async () => {
    render(<App />);

    const header = screen.getByRole("banner", { name: "Application Header" });
    expect(screen.getByRole("region", { name: "Files" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Editor")).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "File" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Run Lint" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Format" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "Terminal" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Problems" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Git" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Usages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Git Trace" })).not.toBeInTheDocument();
    const statusBar = screen.getByLabelText("Status Bar");
    expect(statusBar).toBeInTheDocument();
    expect(within(statusBar).getByLabelText("Status Bar Left")).toBeInTheDocument();
    expect(within(statusBar).getByLabelText("Status Bar Right")).toBeInTheDocument();
    expect(within(statusBar).getByText("Workspace: none")).toHaveClass("status-pill--em");
    expect(within(statusBar).getByText("Ready")).toHaveClass("status-pill--em");
    expect(within(screen.getByLabelText("Files")).getByText("Project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project" })).toHaveAttribute("aria-pressed", "true");
    expect(within(header).getByRole("button", { name: "Settings" })).toHaveClass("toolbar__button--primary");
    expect(await screen.findByLabelText("Semantic Mode")).toHaveTextContent("Fallback");
  });

  it("maximizes and restores the bottom tool window from the chrome actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    const bottomToolWindow = screen.getByLabelText("Bottom Tool Window");
    expect(bottomToolWindow).toHaveStyle({ height: "280px" });

    await user.click(screen.getByRole("button", { name: "Maximize Bottom Tool Window" }));

    expect(bottomToolWindow).not.toHaveStyle({ height: "280px" });
    expect(screen.getByRole("button", { name: "Restore Bottom Tool Window" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Restore Bottom Tool Window" }));

    expect(bottomToolWindow).toHaveStyle({ height: "280px" });
    expect(screen.getByRole("button", { name: "Maximize Bottom Tool Window" })).toBeVisible();
  });

  it("clears terminal active state when the bottom tool window is hidden and restores it from the toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);

    const header = screen.getByRole("banner", { name: "Application Header" });
    const terminalButton = within(header).getByRole("button", { name: "Terminal" });

    await user.click(terminalButton);

    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(terminalButton).toHaveClass("toolbar__button--active");
    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "false");

    await user.click(screen.getByRole("button", { name: "Hide Bottom Tool Window" }));

    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "true");
    expect(terminalButton).not.toHaveClass("toolbar__button--active");

    await user.click(terminalButton);

    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(terminalButton).toHaveClass("toolbar__button--active");
  });

  it("uses an explicit restore action after the bottom tool window is hidden", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Hide Bottom Tool Window" }));

    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "true");
    expect(screen.queryByRole("button", { name: "Hide Bottom Tool Window" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Bottom Tool Window" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show Bottom Tool Window" }));

    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByRole("button", { name: "Hide Bottom Tool Window" })).toBeVisible();
  });

  it("shows fallback semantic mode in the status bar", async () => {
    render(<AppShell />);

    expect(await screen.findByLabelText("Semantic Mode")).toHaveTextContent("Fallback");
  });

  it("opens terminal from the top bar", async () => {
    const user = userEvent.setup();
    render(<App />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await user.click(within(header).getByRole("button", { name: "Terminal" }));
    expect(await screen.findByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: "pwsh" })).toBeVisible();
    expect(await screen.findByLabelText("Terminal Viewport")).toBeVisible();
  });

  it("opens the top menu actions for file edit and view", async () => {
    const user = userEvent.setup();
    render(<App />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await user.click(within(header).getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    expect(await screen.findByLabelText("Open Project")).toBeVisible();

    await user.click(within(header).getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("menuitem", { name: "Settings" }));
    expect(await screen.findByLabelText("Settings")).toBeVisible();

    await user.click(within(header).getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Terminal" }));
    expect(await screen.findByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens a second project in a new window when the current window is already occupied", async () => {
    const user = userEvent.setup();
    const openWorkspaceInNewWindow = vi.fn(async () => undefined);
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async (rootPath: string) => ({
        rootName: rootPath.split("/").at(-1) ?? "Workspace",
        rootPath,
        files: [`${rootPath}/src/main.ets`, `${rootPath}/AppScope/app.json5`],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets", "C:/samples/DemoWorkspace/AppScope/app.json5"],
      }),
      ...( { openWorkspaceInNewWindow } as Partial<WorkspaceApi> ),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    expect(screen.getByText("Workspace: DemoWorkspace")).toBeVisible();

    await openProject(user, "C:/samples/ArkDemo", "New Window");

    expect(openWorkspaceInNewWindow).toHaveBeenCalledWith("C:/samples/ArkDemo");
    expect(screen.getByText("Workspace: DemoWorkspace")).toBeVisible();
  });

  it("opens a project directly in the current window when no workspace is loaded", async () => {
    const user = userEvent.setup();
    const openWorkspace = vi.fn(async (rootPath: string) => ({
      rootName: rootPath.split("/").at(-1) ?? "Workspace",
      rootPath,
      files: [`${rootPath}/src/main.ets`],
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ openWorkspace })} />);

    await openProject(user, "C:/samples/ArkDemo");

    expect(screen.queryByRole("dialog", { name: "Open Project Decision" })).not.toBeInTheDocument();
    expect(openWorkspace).toHaveBeenCalledWith("C:/samples/ArkDemo");
  });

  it("asks whether to use this window or a new window when a workspace is already loaded", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await openProject(user, "C:/samples/ArkDemo", null);

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
    await openProject(user, "C:/samples/ArkDemo", "Cancel");

    expect(screen.getByText("Workspace: DemoWorkspace")).toBeVisible();
    expect(await screen.findByRole("button", { name: "main.ets", pressed: true })).toBeVisible();
  });

  it("replaces the current workspace when This Window is selected", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await openProject(user, "C:/samples/ArkDemo");

    expect(await screen.findByText("Workspace: ArkDemo")).toBeVisible();
  });

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

  it("opens a native-project fallback dialog from File -> Open Project", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));

    expect(await screen.findByLabelText("Open Project")).toBeVisible();
    expect(screen.getByLabelText("Project Path")).toBeVisible();
  });

  it("toggles the files pane from the toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);

    const filesPane = screen.getByRole("region", { name: "Files" });
    expect(filesPane).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(filesPane).not.toBeVisible();

    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(filesPane).toBeVisible();
  });

  it("resizes the left navigation pane by dragging and keyboard controls", async () => {
    render(<App />);

    const shellGrid = document.querySelector<HTMLElement>(".shell-grid");
    const separator = screen.getByRole("separator", { name: "Resize Left Navigation" });
    expect(shellGrid).toHaveStyle({ gridTemplateColumns: "316px 1fr" });
    expect(separator).toHaveAttribute("aria-valuenow", "316");

    await act(async () => {
      fireEvent.mouseDown(separator, { clientX: 316 });
      fireEvent.mouseMove(window, { clientX: 420 });
      fireEvent.mouseUp(window, { clientX: 420 });
    });
    expect(shellGrid).toHaveStyle({ gridTemplateColumns: "420px 1fr" });
    expect(separator).toHaveAttribute("aria-valuenow", "420");

    await act(async () => {
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
    });
    expect(shellGrid).toHaveStyle({ gridTemplateColumns: "410px 1fr" });

    await act(async () => {
      fireEvent.keyDown(separator, { key: "Home" });
    });
    expect(shellGrid).toHaveStyle({ gridTemplateColumns: "220px 1fr" });

    await act(async () => {
      fireEvent.keyDown(separator, { key: "End" });
    });
    expect(shellGrid).toHaveStyle({ gridTemplateColumns: "520px 1fr" });
  });

  it("does not show a left-rail search tool", async () => {
    render(<App />);
    const toolRail = screen.getByLabelText("Primary Tool Window Rail");

    expect(within(toolRail).queryByRole("button", { name: "Search" })).not.toBeInTheDocument();
  });

  it("keeps the files pane as the only left sidebar tool window", async () => {
    render(<App />);

    expect(screen.getByRole("region", { name: "Files" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeInTheDocument();
  });

  it("loads a workspace into the files pane", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);

    expect(await screen.findByRole("button", { name: "app.json5" })).toBeVisible();
    expect(screen.getByRole("button", { name: "main.ets" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "index.js" })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace: DemoWorkspace")).toBeVisible();
  });

  it("supports project tree expand collapse and focus active file actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));

    const filesPane = screen.getByRole("region", { name: "Files" });
    await user.click(within(filesPane).getByRole("button", { name: "Collapse All" }));

    expect(within(filesPane).queryByRole("button", { name: "main.ets" })).not.toBeInTheDocument();

    await user.click(within(filesPane).getByRole("button", { name: "Focus Active File" }));

    const activeFile = await waitFor(() => {
      const row = within(filesPane).getByRole("button", { name: "main.ets" });
      expect(row).toHaveAttribute("aria-current", "true");
      return row;
    });
    expect(activeFile).toBeVisible();
    await waitFor(() => expect(activeFile).toHaveFocus());

    await user.click(within(filesPane).getByRole("button", { name: "Collapse All" }));
    expect(within(filesPane).queryByRole("button", { name: "app.json5" })).not.toBeInTheDocument();

    await user.click(within(filesPane).getByRole("button", { name: "Expand All" }));
    expect(await within(filesPane).findByRole("button", { name: "app.json5" })).toBeVisible();
  });

  it("opens workspace edit previews for project tree new file and directory actions", async () => {
    const user = userEvent.setup();
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [],
      affectedFiles: [],
      summary: plan.operations.map((operation) => operation.kind),
    }));
    render(<AppShell workspaceApi={createWorkspaceApi({ previewWorkspaceEdit })} />);

    await openProject(user);
    const filesPane = screen.getByRole("region", { name: "Files" });

    await user.click(within(filesPane).getByRole("button", { name: "New File" }));
    await user.type(await screen.findByLabelText("New File Name"), "Home.ets");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(previewWorkspaceEdit).toHaveBeenLastCalledWith({
      workspaceRoot: expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace/),
      plan: expect.objectContaining({
        title: "Create File Home.ets",
        operations: [
          {
            kind: "createFile",
            path: expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace[/\\]Home\.ets/),
            content: "",
            overwrite: false,
          },
        ],
      }),
    }));
    expect(await screen.findByRole("dialog", { name: "Workspace Edit Preview" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close Workspace Edit Preview" }));
    await user.click(within(filesPane).getByRole("button", { name: "New Directory" }));
    await user.type(await screen.findByLabelText("New Directory Name"), "features");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(previewWorkspaceEdit).toHaveBeenLastCalledWith({
      workspaceRoot: expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace/),
      plan: expect.objectContaining({
        title: "Create Directory features",
        operations: [
          {
            kind: "createDirectory",
            path: expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace[/\\]features/),
          },
        ],
      }),
    }));
  });

  it("opens a file from the workspace into the editor surface", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));

    expect(screen.getByLabelText("Editor")).toHaveClass("editor-surface--active");
    const activeTab = await screen.findByRole("button", { name: "main.ets", pressed: true });
    expect(activeTab).toBeVisible();
    expect(activeTab).toHaveClass("editor-tab--active");
    const editor = await screen.findByLabelText("Editor Content", undefined, { timeout: 5000 });
    expect(editor).toHaveTextContent("@Entry");
    expect(editor).toHaveTextContent("struct Index {}");
  });

  it("opens quick open from the keyboard and filters workspace paths", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.keyboard("{Control>}p{/Control}");

    const query = await screen.findByLabelText("Quick Open Query");
    await user.type(query, "main");

    const results = screen.getByRole("list", { name: "Quick Open Results" });
    expect(within(results).getByRole("button", { name: "C:\\samples\\DemoWorkspace\\src\\main.ets" })).toBeVisible();
  });

  it("searches workspace text with regex and text options, groups relative path results, previews the selected hit, and opens the file", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find in Files" }));

    const query = await screen.findByLabelText("Find in Files Query");
    await user.type(query, "entry");
    expect(screen.getByRole("button", { name: "Close Find in Files" })).toBeVisible();
    expect(within(screen.getByRole("list", { name: "Find in Files Results" })).getByText("main.ets")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Aa" }));
    expect(within(screen.getByRole("list", { name: "Find in Files Results" })).getByText("No matches")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Aa" }));
    await user.clear(query);
    await user.type(query, "/bundleName/");

    const results = screen.getByRole("list", { name: "Find in Files Results" });
    expect(within(results).getByText("app.json5")).toBeVisible();
    expect(within(results).getByText("AppScope/app.json5")).toBeVisible();
    expect(within(results).getByText("3:6")).toBeVisible();
    expect(within(results).queryByText("C:\\samples\\DemoWorkspace\\AppScope\\app.json5")).not.toBeInTheDocument();

    const preview = screen.getByLabelText("Search Everywhere Preview");
    expect(within(preview).getByText("AppScope/app.json5:3:6")).toBeVisible();
    expect(within(preview).getByText("bundleName")).toBeVisible();

    await user.click(within(results).getByRole("button", { name: /app\.json5/i }));

    expect(screen.queryByLabelText("Search Everywhere Overlay")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "app.json5", pressed: true })).toBeVisible();
    const editor = await screen.findByLabelText("Editor Content");
    expect(editor).toHaveTextContent("\"bundleName\": \"com.demo.app\"");
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("opens Replace in Files from the menu with a replace input", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Replace in Files" }));

    expect(await screen.findByLabelText("Replace in Files Query")).toHaveFocus();
    expect(screen.getByLabelText("Replace With")).toBeVisible();
    expect(screen.getByRole("list", { name: "Replace in Files Results" })).toBeVisible();
  });

  it("keeps Search Everywhere open for panel clicks and closes it from outside or close button", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Search Everywhere" }));

    const overlay = await screen.findByLabelText("Search Everywhere Overlay");
    const query = await screen.findByLabelText("Search Everywhere Query");
    await user.type(query, "entry");

    fireEvent.mouseDown(within(overlay).getByText("Search Everywhere"));
    expect(screen.getByLabelText("Search Everywhere Overlay")).toBeVisible();

    fireEvent.mouseDown(overlay);
    expect(screen.queryByLabelText("Search Everywhere Overlay")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Search Everywhere" }));
    await user.click(await screen.findByRole("button", { name: "Close Search Everywhere" }));

    expect(screen.queryByLabelText("Search Everywhere Overlay")).not.toBeInTheDocument();
  });

  it("reopens a recent project from the File menu", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user, "C:/samples/AlphaWorkspace");
    await openProject(user, "C:/samples/BetaWorkspace");

    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Recent Projects" }));
    const results = await screen.findByRole("list", { name: "Recent Projects Results" });
    await user.click(within(results).getByRole("button", { name: "AlphaWorkspace C:\\samples\\AlphaWorkspace" }));
    await user.click(await screen.findByRole("button", { name: "This Window" }));

    expect(screen.queryByLabelText("Recent Projects Overlay")).not.toBeInTheDocument();
    expect(await screen.findByText("Workspace: AlphaWorkspace")).toBeVisible();
    expect(await screen.findByRole("button", { name: "main.ets" })).toBeVisible();
  });

  it("asks for this window or new window when reopening a recent project from an occupied window", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await openProject(user, "C:/samples/DemoWorkspace");
    await openProject(user, "C:/samples/ArkDemo");

    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Recent Projects" }));
    const results = await screen.findByRole("list", { name: "Recent Projects Results" });
    await user.click(within(results).getByRole("button", { name: "DemoWorkspace C:\\samples\\DemoWorkspace" }));

    expect(await screen.findByRole("dialog", { name: "Open Project Decision" })).toBeVisible();
  });

  it("moves the caret with Go to Line from the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await user.type(await screen.findByLabelText("Find Action Query"), "go to line");
    await user.click(await screen.findByRole("button", { name: "Go to Line..." }));
    await user.type(await screen.findByLabelText("Go to Line Query"), "2");
    await user.keyboard("{Enter}");

    const editor = await screen.findByLabelText("Editor Content");
    expect(screen.queryByLabelText("Go to Line Overlay")).not.toBeInTheDocument();
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("X");
    expect(editor).toHaveTextContent("@EntryX@Componentstruct Index {}");
  });

  it("opens current-class methods with Ctrl+F7, filters, and jumps to the selected method", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => [
        "@Entry",
        "@Component",
        "struct Index {",
        "  aboutToAppear() {}",
        "  build() {}",
        "  private handleTap(event: ClickEvent) {}",
        "}",
      ].join("\n"),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.keyboard("{Control>}{F7}{/Control}");

    expect(await screen.findByRole("dialog", { name: "Methods in Current Class" })).toBeVisible();
    expect(screen.getByRole("option", { name: /build\(\).*line 5/ })).toBeVisible();

    await user.type(screen.getByLabelText("Current Class Method Query"), "tap");
    expect(screen.queryByRole("option", { name: /build\(\)/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /handleTap\(event: ClickEvent\).*line 6/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "Methods in Current Class" })).not.toBeInTheDocument();
    expect(await screen.findByText("Method: handleTap(event: ClickEvent)")).toBeVisible();
  });

  it("shows shortcut hints in the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await user.type(await screen.findByLabelText("Find Action Query"), "definition");

    const results = await screen.findByRole("list", { name: "Find Action Results" });
    expect(within(results).getByRole("button", { name: "Go to Definition" })).toBeVisible();
    expect(within(results).getByText(/^(Ctrl|Cmd)\+B$/)).toBeVisible();
  });

  it("opens code action palette with Alt+Enter and lists action title kind and disabled reason", async () => {
    const user = userEvent.setup();
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.add-missing-import",
        title: "Add missing import",
        kind: "quickfix" as const,
        provider: "arkts" as const,
        safety: "safe" as const,
      },
      {
        id: "arkts.extract-function",
        title: "Extract function",
        kind: "refactor.extract" as const,
        provider: "arkts" as const,
        safety: "needsPreview" as const,
        disabledReason: "Select an expression first",
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");

    expect(await screen.findByRole("dialog", { name: "Code Actions" })).toBeVisible();
    const results = screen.getByRole("listbox", { name: "Code Actions" });
    expect(within(results).getByRole("option", { name: /Add missing import.*Quick Fix/ })).toBeVisible();
    expect(within(results).getByRole("option", { name: /Extract function.*Refactor: Extract.*Select an expression first/ })).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(listCodeActions).toHaveBeenCalledWith(expect.objectContaining({
      path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
      content: expect.stringContaining("struct Index"),
    })));
  });

  it("resolves the selected code action with Enter", async () => {
    const user = userEvent.setup();
    const resolveCodeAction = vi.fn(async () => ({
      status: "unsupported" as const,
      reason: "Action resolution is not wired yet",
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.add-missing-import",
        title: "Add missing import",
        kind: "quickfix" as const,
        provider: "arkts" as const,
        safety: "safe" as const,
        data: { import: "router" },
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");

    await waitFor(() => expect(resolveCodeAction).toHaveBeenCalledWith({
      id: "arkts.add-missing-import",
      data: { import: "router" },
    }));
    expect(await screen.findByText("Code action unsupported: Action resolution is not wired yet")).toBeVisible();
  });

  it("resolves the focused code action when keyboard focus moves through the palette", async () => {
    const user = userEvent.setup();
    const resolveCodeAction = vi.fn(async () => ({
      status: "unsupported" as const,
      reason: "Action resolution is not wired yet",
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.first",
        title: "First action",
        kind: "quickfix" as const,
        provider: "arkts" as const,
        safety: "safe" as const,
      },
      {
        id: "arkts.second",
        title: "Second action",
        kind: "quickfix" as const,
        provider: "arkts" as const,
        safety: "safe" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    const palette = await screen.findByRole("dialog", { name: "Code Actions" });
    act(() => {
      within(palette).getByRole("option", { name: /Second action/ }).focus();
    });
    await user.keyboard("{Enter}");

    await waitFor(() => expect(resolveCodeAction).toHaveBeenCalledWith({
      id: "arkts.second",
      data: undefined,
    }));
  });

  it("filters F2 to rename code actions", async () => {
    const user = userEvent.setup();
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.generate-page",
        title: "Generate ArkTS Page",
        kind: "source" as const,
        provider: "arkts" as const,
        safety: "needsPreview" as const,
      },
      {
        id: "arkts.rename-file",
        title: "Rename File",
        kind: "refactor.rewrite" as const,
        provider: "arkts" as const,
        safety: "needsPreview" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions })} />);

    await openMainEditor(user);
    await user.keyboard("{F2}");

    const results = await screen.findByRole("listbox", { name: "Code Actions" });
    expect(within(results).getByRole("option", { name: /Rename File/ })).toBeVisible();
    expect(within(results).queryByRole("option", { name: /Generate ArkTS Page/ })).not.toBeInTheDocument();
  });

  it("ignores stale code action resolutions after the palette closes", async () => {
    const user = userEvent.setup();
    let finishResolve!: (value: Awaited<ReturnType<NonNullable<WorkspaceApi["resolveCodeAction"]>>>) => void;
    const resolveCodeAction = vi.fn(() => new Promise<Awaited<ReturnType<NonNullable<WorkspaceApi["resolveCodeAction"]>>>>((resolve) => {
      finishResolve = resolve;
    }));
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [],
      affectedFiles: plan.affectedFiles,
      summary: ["Edit C:/samples/DemoWorkspace/src/main.ets at 3:1-3:1"],
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.extract-function",
        title: "Extract function",
        kind: "refactor.extract" as const,
        provider: "arkts" as const,
        safety: "risky" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");
    await waitFor(() => expect(resolveCodeAction).toHaveBeenCalled());
    await user.keyboard("{Escape}");
    finishResolve({
      id: "plan.extract",
      title: "Extract function",
      operations: [
        {
          kind: "text" as const,
          path: "C:/samples/DemoWorkspace/src/main.ets",
          range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
          newText: "function extracted() {}\n",
        },
      ],
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      undoLabel: "Undo Extract function",
      requiresPreview: true,
    });

    await waitFor(() => expect(previewWorkspaceEdit).not.toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: "Workspace Edit Preview" })).not.toBeInTheDocument();
  });

  it("does not trigger code actions while Settings is open", async () => {
    const user = userEvent.setup();
    const listCodeActions = vi.fn(async () => []);
    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions })} />);

    await openMainEditor(user);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();
    await user.keyboard("{Alt>}{Enter}{/Alt}");

    expect(listCodeActions).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Code Actions" })).not.toBeInTheDocument();
  });

  it("opens a workspace edit preview for risky actions without applying edits", async () => {
    const user = userEvent.setup();
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      summary: ["Edit C:/samples/DemoWorkspace/src/main.ets at 3:1-3:1"],
    }));
    const applyWorkspaceEdit = vi.fn(async () => ({ applied: true, conflicts: [], changedFiles: [] }));
    const resolveCodeAction = vi.fn(async () => ({
      id: "plan.extract",
      title: "Extract function",
      operations: [
        {
          kind: "text" as const,
          path: "C:/samples/DemoWorkspace/src/main.ets",
          range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
          newText: "function extracted() {}\n",
        },
      ],
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      undoLabel: "Undo Extract function",
      requiresPreview: true,
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.extract-function",
        title: "Extract function",
        kind: "refactor.extract" as const,
        provider: "arkts" as const,
        safety: "risky" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit, applyWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");

    const preview = await screen.findByRole("dialog", { name: "Workspace Edit Preview" });
    expect(within(preview).getByText("Extract function")).toBeVisible();
    expect(within(within(preview).getByLabelText("Affected Files")).getByText("C:/samples/DemoWorkspace/src/main.ets")).toBeVisible();
    expect(within(preview).getByText("Edit C:/samples/DemoWorkspace/src/main.ets at 3:1-3:1")).toBeVisible();
    await waitFor(() => expect(previewWorkspaceEdit).toHaveBeenCalledWith({
      workspaceRoot: "C:\\samples\\DemoWorkspace",
      plan: expect.objectContaining({ id: "plan.extract" }),
    }));
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("applies a workspace edit preview and closes on success", async () => {
    const user = userEvent.setup();
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      summary: ["Edit C:/samples/DemoWorkspace/src/main.ets at 3:1-3:1"],
    }));
    const applyWorkspaceEdit = vi.fn(async () => ({
      applied: true,
      conflicts: [],
      changedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
    }));
    const resolveCodeAction = vi.fn(async () => ({
      id: "plan.extract",
      title: "Extract function",
      operations: [
        {
          kind: "text" as const,
          path: "C:/samples/DemoWorkspace/src/main.ets",
          range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
          newText: "function extracted() {}\n",
        },
      ],
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      undoLabel: "Undo Extract function",
      requiresPreview: true,
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.extract-function",
        title: "Extract function",
        kind: "refactor.extract" as const,
        provider: "arkts" as const,
        safety: "risky" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit, applyWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Apply Workspace Edit" }));

    await waitFor(() => expect(applyWorkspaceEdit).toHaveBeenCalledWith({
      workspaceRoot: "C:\\samples\\DemoWorkspace",
      plan: expect.objectContaining({ id: "plan.extract" }),
    }));
    expect(screen.queryByRole("dialog", { name: "Workspace Edit Preview" })).not.toBeInTheDocument();
    expect(await screen.findByText("Workspace edit applied: 1 file changed")).toBeVisible();
  });

  it("cancels a workspace edit preview without applying edits", async () => {
    const user = userEvent.setup();
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      summary: ["Edit C:/samples/DemoWorkspace/src/main.ets at 3:1-3:1"],
    }));
    const applyWorkspaceEdit = vi.fn(async () => ({ applied: true, conflicts: [], changedFiles: [] }));
    const resolveCodeAction = vi.fn(async () => ({
      id: "plan.extract",
      title: "Extract function",
      operations: [
        {
          kind: "text" as const,
          path: "C:/samples/DemoWorkspace/src/main.ets",
          range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
          newText: "function extracted() {}\n",
        },
      ],
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      undoLabel: "Undo Extract function",
      requiresPreview: true,
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.extract-function",
        title: "Extract function",
        kind: "refactor.extract" as const,
        provider: "arkts" as const,
        safety: "risky" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit, applyWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Cancel Workspace Edit" }));

    expect(screen.queryByRole("dialog", { name: "Workspace Edit Preview" })).not.toBeInTheDocument();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("disables workspace edit apply when preview reports conflicts", async () => {
    const user = userEvent.setup();
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [{ path: "C:/samples/DemoWorkspace/src/main.ets", message: "File changed on disk" }],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      summary: ["Edit C:/samples/DemoWorkspace/src/main.ets at 3:1-3:1"],
    }));
    const applyWorkspaceEdit = vi.fn(async () => ({ applied: true, conflicts: [], changedFiles: [] }));
    const resolveCodeAction = vi.fn(async () => ({
      id: "plan.extract",
      title: "Extract function",
      operations: [
        {
          kind: "text" as const,
          path: "C:/samples/DemoWorkspace/src/main.ets",
          range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
          newText: "function extracted() {}\n",
        },
      ],
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      undoLabel: "Undo Extract function",
      requiresPreview: true,
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.extract-function",
        title: "Extract function",
        kind: "refactor.extract" as const,
        provider: "arkts" as const,
        safety: "risky" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit, applyWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");

    const preview = await screen.findByRole("dialog", { name: "Workspace Edit Preview" });
    expect(within(preview).getByText("File changed on disk")).toBeVisible();
    expect(within(preview).getByRole("button", { name: "Apply Workspace Edit" })).toBeDisabled();
    expect(applyWorkspaceEdit).not.toHaveBeenCalled();
  });

  it("keeps a workspace edit preview open while apply is pending", async () => {
    const user = userEvent.setup();
    let finishApply!: (value: Awaited<ReturnType<NonNullable<WorkspaceApi["applyWorkspaceEdit"]>>>) => void;
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      summary: ["Edit C:/samples/DemoWorkspace/src/main.ets at 3:1-3:1"],
    }));
    const applyWorkspaceEdit = vi.fn(() => new Promise<Awaited<ReturnType<NonNullable<WorkspaceApi["applyWorkspaceEdit"]>>>>((resolve) => {
      finishApply = resolve;
    }));
    const resolveCodeAction = vi.fn(async () => ({
      id: "plan.extract",
      title: "Extract function",
      operations: [
        {
          kind: "text" as const,
          path: "C:/samples/DemoWorkspace/src/main.ets",
          range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 1 },
          newText: "function extracted() {}\n",
        },
      ],
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
      undoLabel: "Undo Extract function",
      requiresPreview: true,
    }));
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.extract-function",
        title: "Extract function",
        kind: "refactor.extract" as const,
        provider: "arkts" as const,
        safety: "risky" as const,
      },
    ]);

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit, applyWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");
    const preview = await screen.findByRole("dialog", { name: "Workspace Edit Preview" });
    await user.click(within(preview).getByRole("button", { name: "Apply Workspace Edit" }));

    expect(within(preview).getByRole("button", { name: "Cancel Workspace Edit" })).toBeDisabled();
    expect(within(preview).getByRole("button", { name: "Close Workspace Edit Preview" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Workspace Edit Preview" })).toBeVisible();

    finishApply({
      applied: true,
      conflicts: [],
      changedFiles: ["C:/samples/DemoWorkspace/src/main.ets"],
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Workspace Edit Preview" })).not.toBeInTheDocument());
  });

  it("applies Generate ArkTS Page from the IDE and updates the file tree", async () => {
    const user = userEvent.setup();
    const listCodeActions = vi.fn(async () => [
      {
        id: "arkts.generate.page",
        title: "Generate ArkTS Page",
        kind: "generate" as const,
        provider: "template" as const,
        safety: "needsPreview" as const,
        data: { name: "Home", targetPath: "src/pages/Home.ets" },
      },
    ]);
    const plan = {
      id: "arkts.generate.page",
      title: "Generate ArkTS Page",
      operations: [
        {
          kind: "createFile" as const,
          path: "src/pages/Home.ets",
          content: "@Entry\n@Component\nstruct Home {\n  build() {\n  }\n}\n",
          overwrite: false,
        },
      ],
      conflicts: [],
      affectedFiles: ["src/pages/Home.ets"],
      undoLabel: "Remove generated ArkTS page",
      requiresPreview: true,
    };
    const resolveCodeAction = vi.fn(async () => plan);
    const previewWorkspaceEdit = vi.fn(async () => ({
      plan,
      conflicts: [],
      affectedFiles: ["src/pages/Home.ets"],
      summary: ["Create src/pages/Home.ets"],
    }));
    const applyWorkspaceEdit = vi.fn(async () => ({
      applied: true,
      conflicts: [],
      changedFiles: ["src/pages/Home.ets"],
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit, applyWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{Alt>}{Enter}{/Alt}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Apply Workspace Edit" }));

    await waitFor(() => expect(applyWorkspaceEdit).toHaveBeenCalledWith({
      workspaceRoot: "C:\\samples\\DemoWorkspace",
      plan,
    }));
    expect(await screen.findByRole("button", { name: "Home.ets" })).toBeVisible();
  });

  it("applies Rename File from the IDE and updates the file tree", async () => {
    const user = userEvent.setup();
    const listCodeActions = vi.fn(async () => [
      {
        id: "workspace.renameFile",
        title: "Rename File",
        kind: "source" as const,
        provider: "workspace" as const,
        safety: "needsPreview" as const,
        data: {
          currentPath: "C:/samples/DemoWorkspace/src/main.ets",
          targetPath: "C:/samples/DemoWorkspace/src/Home.ets",
        },
      },
    ]);
    const plan = {
      id: "workspace.renameFile.C:/samples/DemoWorkspace/src/main.ets",
      title: "Rename main.ets to Home.ets",
      operations: [
        {
          kind: "renameFile" as const,
          oldPath: "C:/samples/DemoWorkspace/src/main.ets",
          newPath: "C:/samples/DemoWorkspace/src/Home.ets",
          overwrite: false,
        },
      ],
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets", "C:/samples/DemoWorkspace/src/Home.ets"],
      undoLabel: "Rename Home.ets back to main.ets",
      requiresPreview: true,
    };
    const resolveCodeAction = vi.fn(async () => plan);
    const previewWorkspaceEdit = vi.fn(async () => ({
      plan,
      conflicts: [],
      affectedFiles: ["C:/samples/DemoWorkspace/src/main.ets", "C:/samples/DemoWorkspace/src/Home.ets"],
      summary: ["Rename C:/samples/DemoWorkspace/src/main.ets to C:/samples/DemoWorkspace/src/Home.ets"],
    }));
    const applyWorkspaceEdit = vi.fn(async () => ({
      applied: true,
      conflicts: [],
      changedFiles: ["C:/samples/DemoWorkspace/src/main.ets", "C:/samples/DemoWorkspace/src/Home.ets"],
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ listCodeActions, resolveCodeAction, previewWorkspaceEdit, applyWorkspaceEdit })} />);

    await openMainEditor(user);
    await user.keyboard("{F2}");
    await screen.findByRole("dialog", { name: "Code Actions" });
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "Apply Workspace Edit" }));

    await waitFor(() => expect(applyWorkspaceEdit).toHaveBeenCalledWith({
      workspaceRoot: "C:\\samples\\DemoWorkspace",
      plan,
    }));
    const filesPane = screen.getByLabelText("Files");
    expect(await within(filesPane).findByRole("button", { name: "Home.ets" })).toBeVisible();
    expect(within(filesPane).queryByRole("button", { name: "main.ets" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home.ets", pressed: true })).toBeVisible();
    expect(screen.queryByTitle("C:\\samples\\DemoWorkspace\\src\\main.ets")).not.toBeInTheDocument();
  });

  it("keeps command palette panel clicks inside and closes from its backdrop or close button", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");

    const overlay = await screen.findByLabelText("Find Action Overlay");
    expect(await screen.findByRole("dialog", { name: "Find Action" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close Find Action" })).toBeVisible();

    fireEvent.mouseDown(within(overlay).getByText("Find Action"));
    expect(screen.getByLabelText("Find Action Overlay")).toBeVisible();

    fireEvent.mouseDown(overlay);
    expect(screen.queryByLabelText("Find Action Overlay")).not.toBeInTheDocument();

    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await user.click(await screen.findByRole("button", { name: "Close Find Action" }));
    expect(screen.queryByLabelText("Find Action Overlay")).not.toBeInTheDocument();
  });

  it("shows an empty state when command palette search has no matches", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await user.type(await screen.findByLabelText("Find Action Query"), "no such command");

    expect(await screen.findByText("No actions found")).toBeVisible();
  });

  it("shows Find and Replace in Files in the command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await user.type(await screen.findByLabelText("Find Action Query"), "find in files");

    expect(await screen.findByRole("button", { name: "Find in Files" })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Shift\+F$/)).toBeVisible();

    await user.clear(screen.getByLabelText("Find Action Query"));
    await user.type(screen.getByLabelText("Find Action Query"), "replace in files");

    expect(await screen.findByRole("button", { name: "Replace in Files" })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Shift\+R$/)).toBeVisible();
  });

  it("shows shortcut hints in top bar menus", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(await screen.findByRole("menuitem", { name: "Command Palette" })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Shift\+A$/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "View" }));

    expect(await screen.findByRole("menuitem", { name: "Search Everywhere" })).toBeVisible();
    expect(screen.getByText("Double Shift")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Find in Files" })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Shift\+F$/)).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Replace in Files" })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Shift\+R$/)).toBeVisible();
    expect(screen.getByText("Alt+F12")).toBeVisible();
  });

  it("jumps to a definition from the current editor caret", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      gotoDefinition: vi.fn(async () => ({
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 1,
      })),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await user.type(await screen.findByLabelText("Find Action Query"), "go to line");
    await user.click(await screen.findByRole("button", { name: "Go to Line..." }));
    await user.type(await screen.findByLabelText("Go to Line Query"), "1:1");
    await user.keyboard("{Enter}");

    const editor = await screen.findByLabelText("Editor Content");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{Control>}b{/Control}");
    await waitFor(() => {
      expect(workspaceApi.gotoDefinition).toHaveBeenCalledWith(expect.objectContaining({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 2,
        column: 1,
        content: expect.stringContaining("struct Index"),
      }));
    });
  });

  it("opens SDK declaration targets returned by go to definition", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: vi.fn(async (path: string) => path.endsWith("common.d.ts")
        ? "declare class CommonMethod<T> {\n  width(value: Length): T;\n}"
        : "@Entry\n@Component\nstruct Index {\n  build() {\n    Column() {}\n      .width(100)\n  }\n}"),
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      gotoDefinition: vi.fn(async () => ({
        path: "C:/HarmonyOS/Sdk/ets/component/common.d.ts",
        line: 2,
        column: 3,
      })),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.keyboard("{Control>}{Shift>}a{/Shift}{/Control}");
    await user.type(await screen.findByLabelText("Find Action Query"), "go to line");
    await user.click(await screen.findByRole("button", { name: "Go to Line..." }));
    await user.type(await screen.findByLabelText("Go to Line Query"), "6:8");
    await user.keyboard("{Enter}");

    const editor = await screen.findByLabelText("Editor Content");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{Control>}b{/Control}");
    await waitFor(() => {
      expect(workspaceApi.gotoDefinition).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(workspaceApi.openFile).toHaveBeenCalledWith("C:/HarmonyOS/Sdk/ets/component/common.d.ts");
    });

    expect(await screen.findByRole("button", { name: "common.d.ts" })).toBeVisible();
    expect(await screen.findByLabelText("Editor Content")).toHaveTextContent("width(value: Length): T");
  });

  it("opens completion from the editor and replaces the typed prefix with the selected item", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "Index", detail: "Struct in current file", kind: "symbol" },
        { label: "build()", detail: "Component lifecycle method", kind: "method", insertText: "build(${1:value})" },
        { label: "@Component", detail: "ArkTS decorator", kind: "keyword" },
        { label: "sharedSubmit()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    await waitFor(() => {
      expect(workspaceApi.completeSymbol).toHaveBeenCalledWith(expect.objectContaining({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 3,
        column: 17,
        content: expect.stringContaining("struct Index"),
      }));
    });

    const results = await screen.findByRole("listbox", { name: "Code Completion" });
    const resultButtons = within(results).getAllByRole("option");
    expect(resultButtons[0]).toHaveTextContent("build()");
    expect(within(results).getByRole("option", { name: /sharedSubmit\(\)/ })).toBeVisible();
    await user.click(within(results).getByRole("option", { name: /build\(\)/ }));

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}build(value)");
  });

  it("shows SDK completion signature and source details", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async (): Promise<LanguageCompletionItem[]> => [{
        label: "width",
        detail: "width(value: Length): T",
        kind: "method",
        insertText: "width(${1:value})",
        filterText: "width",
        source: "arkui",
        documentation: "Sets the width of the component.",
        definitionTarget: { path: "C:/HarmonyOS/Sdk/ets/component/common.d.ts", line: 20927, column: 5 },
      }]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>} {/Control}");

    const popup = await screen.findByRole("listbox", { name: "Code Completion" });
    expect(popup).toBeVisible();
    expect(screen.getByText("width(value: Length): T")).toBeVisible();
    expect(screen.getByText("Sets the width of the component.")).toBeVisible();
    expect(screen.getByText(/common\.d\.ts:20927:5/)).toBeVisible();
  });

  it("keeps completion active when SDK details are clicked", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async (): Promise<LanguageCompletionItem[]> => [{
        label: "width",
        detail: "width(value: Length): T",
        kind: "method",
        insertText: "width(${1:value})",
        filterText: "width",
        source: "arkui",
        documentation: "Sets the width of the component.",
        definitionTarget: { path: "C:/HarmonyOS/Sdk/ets/component/common.d.ts", line: 20927, column: 5 },
      }]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.keyboard("{Control>} {/Control}");

    const popup = await screen.findByRole("listbox", { name: "Code Completion" });
    expect(within(popup).getByRole("option", { name: /width/ })).toHaveAttribute("aria-describedby");
    fireEvent.mouseDown(within(screen.getByLabelText("Completion Details")).getByText("Sets the width of the component."));
    await user.keyboard("{Tab}");

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}width(value)");
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("uses completion replacement ranges when accepting SDK attributes", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () =>
        [
          "@Entry",
          "@Component",
          "struct Index {",
          "  build() {",
          "    Column() {",
          "      Text(\"Hi\")",
          "    }",
          "    .wi",
        ].join("\n"),
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        {
          label: "width",
          detail: "width(value: Length): T",
          kind: "method",
          insertText: "width(${1:value})",
          filterText: "width",
          source: "arkui" as const,
          replacementRange: { startLine: 8, startColumn: 6, endLine: 8, endColumn: 8 },
          definitionTarget: { path: "C:/HarmonyOS/Sdk/ets/component/common.d.ts", line: 20927, column: 5 },
        },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{Control>} {/Control}");
    await waitFor(() => {
      expect(workspaceApi.completeSymbol).toHaveBeenCalledWith(expect.objectContaining({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 8,
        column: 8,
        content: expect.stringContaining(".wi"),
      }));
    });
    const popup = await screen.findByRole("listbox", { name: "Code Completion" });
    await user.click(within(popup).getByRole("option", { name: /width/ }));

    expect(editor).toHaveTextContent(/Column\(\)\s*\{\s*Text\("Hi"\)\s*\}\s*\.width\(value\)/);
    expect(editor).not.toHaveTextContent(".wiwidth(value)");
  });

  it("uses completion replacement ranges when they differ from the local prefix", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => ["@Entry", "@Component", "struct Index {", "  build() {", "    .wi"].join("\n"),
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        {
          label: "width",
          detail: "width(value: Length): T",
          kind: "method",
          insertText: ".width(${1:value})",
          filterText: "width",
          source: "arkui" as const,
          replacementRange: { startLine: 5, startColumn: 5, endLine: 5, endColumn: 8 },
        },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{Control>} {/Control}");
    const popup = await screen.findByRole("listbox", { name: "Code Completion" });
    await user.click(within(popup).getByRole("option", { name: /width/ }));

    expect(editor).toHaveTextContent(/build\(\)\s*\{\s*\.width\(value\)/);
    expect(editor).not.toHaveTextContent("..width(value)");
  });

  it("falls back to the current prefix when completion replacement ranges do not match the caret", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => ["@Entry", "@Component", "struct Index {", "  build() {", "    .wi"].join("\n"),
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        {
          label: "width",
          detail: "width(value: Length): T",
          kind: "method",
          insertText: "width(${1:value})",
          filterText: "width",
          source: "arkui" as const,
          replacementRange: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 7 },
        },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{Control>} {/Control}");
    const popup = await screen.findByRole("listbox", { name: "Code Completion" });
    await user.click(within(popup).getByRole("option", { name: /width/ }));

    expect(editor).toHaveTextContent(/build\(\)\s*\{\s*\.width\(value\)/);
    expect(editor).not.toHaveTextContent(/build\(\)\s*\{\s*width\(value\)/);
  });

  it("refreshes an open completion popup once when Ctrl+Space is pressed again", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method", insertText: "build(${1:value})" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");
    await screen.findByRole("listbox", { name: "Code Completion" });
    await waitFor(() => expect(workspaceApi.completeSymbol).toHaveBeenCalledTimes(1));

    await user.keyboard("{Control>} {/Control}");

    await waitFor(() => expect(workspaceApi.completeSymbol).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("listbox", { name: "Code Completion" })).toBeVisible();
  });

  it("blocks definition and completion while settings are applying", async () => {
    const user = userEvent.setup();
    let finishSave!: () => void;
    const saveSettings = vi.fn(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const gotoDefinition = vi.fn(async () => ({
      path: "C:/samples/DemoWorkspace/src/main.ets",
      line: 1,
      column: 1,
    }));
    const completeSymbol = vi.fn(async () => [
      { label: "build", detail: "Component lifecycle method", kind: "method" },
    ]);
    const findUsages = vi.fn(async () => [
      {
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 1,
        column: 1,
        preview: "@Entry",
      },
    ]);
    const workspaceApi = createWorkspaceApi({ saveSettings, gotoDefinition, completeSymbol, findUsages });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    await user.clear(await screen.findByLabelText("HarmonyOS / ArkTS SDK Path"));
    await user.type(screen.getByLabelText("HarmonyOS / ArkTS SDK Path"), "D:/HarmonyOS/Sdk");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("SDK settings applying...")).toBeVisible();

    await user.click(editor);
    await user.keyboard("{Control>}b{/Control}");
    expect(await screen.findByText("SDK settings are still applying")).toBeVisible();
    await user.keyboard("{Control>} {/Control}");
    await user.keyboard("{Alt>}{F7}{/Alt}");
    await new Promise((resolve) => window.setTimeout(resolve, 160));

    expect(gotoDefinition).not.toHaveBeenCalled();
    expect(completeSymbol).not.toHaveBeenCalled();
    expect(findUsages).not.toHaveBeenCalled();

    finishSave();
    await waitFor(() => expect(screen.getByText("SDK settings applied")).toBeVisible());

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(editor);
    await user.keyboard("{Control>}b{/Control}");
    await waitFor(() => expect(gotoDefinition).toHaveBeenCalled());
    await user.keyboard("{Control>} {/Control}");
    await waitFor(() => expect(completeSymbol).toHaveBeenCalled());
  });

  it("auto-opens completion while typing without stealing editor focus", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    await waitFor(() => {
      expect(workspaceApi.completeSymbol).toHaveBeenCalled();
    });
    const completionList = await screen.findByRole("listbox", { name: "Code Completion" });
    expect(completionList).toBeVisible();
    expect(within(completionList).getByRole("option", { name: /build\(\)/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("hides completion when the caret moves to another line and restores it when returning", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {\n  build() {}\n}",
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
      ]),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    expect(await screen.findByRole("listbox", { name: "Code Completion" })).toBeVisible();

    await user.keyboard("{Control>}{Home}{/Control}");
    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    });

    await user.keyboard("{Control>}{End}{/Control}");
    expect(await screen.findByRole("listbox", { name: "Code Completion" })).toBeVisible();
    expect(within(screen.getByRole("listbox", { name: "Code Completion" })).getByRole("option", { name: /build\(\)/ })).toBeVisible();
  });

  it("does not render automatic completion popup for empty typing results", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => []),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    await waitFor(() => expect(workspaceApi.completeSymbol).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(await screen.findByText("Completion empty")).toBeVisible();
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("shows an empty state for manual completion with no results", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => []),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.keyboard("{Control>} {/Control}");

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("No completions");
    expect(await screen.findByText("Completion empty")).toBeVisible();
  });

  it("ignores stale completion responses after continued typing", async () => {
    const user = userEvent.setup();
    const firstCompletion = deferred<LanguageCompletionItem[]>();
    const secondCompletion = deferred<LanguageCompletionItem[]>();
    const completeSymbol = vi.fn()
      .mockReturnValueOnce(firstCompletion.promise)
      .mockReturnValueOnce(secondCompletion.promise);
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol,
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");
    await waitFor(() => expect(completeSymbol).toHaveBeenCalledTimes(1));

    await user.keyboard("u");
    await waitFor(() => expect(completeSymbol).toHaveBeenCalledTimes(2));
    secondCompletion.resolve([{ label: "button()", detail: "New two-character result", kind: "function" }]);

    const results = await screen.findByRole("listbox", { name: "Code Completion" });
    expect(within(results).getByRole("option", { name: /button\(\)/ })).toBeVisible();
    expect(within(results).queryByRole("option", { name: /build\(\)/ })).not.toBeInTheDocument();

    firstCompletion.resolve([{ label: "build()", detail: "Old one-character result", kind: "method" }]);
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(within(results).getByRole("option", { name: /button\(\)/ })).toBeVisible();
    expect(within(results).queryByRole("option", { name: /build\(\)/ })).not.toBeInTheDocument();
  });

  it("does not trigger automatic completion for space or delete edits", async () => {
    const user = userEvent.setup();
    const completeSymbol = vi.fn(async () => [
      { label: "build()", detail: "Component lifecycle method", kind: "method" },
    ]);
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol,
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control} ");
    await user.keyboard("{Backspace}");
    await new Promise((resolve) => window.setTimeout(resolve, 180));

    expect(completeSymbol).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
  });

  it("positions code completion inside the active editor surface", async () => {
    const user = userEvent.setup();
    const caretRectSpy = mockEditorCaretRect({ top: 180, left: 320, bottom: 204, right: 321 });
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    const completionList = await screen.findByRole("listbox", { name: "Code Completion" });

    expect(completionList).toHaveAttribute("data-anchor", "editor-caret");
    expect(completionList).toHaveStyle({ top: "208px", left: "320px" });
    expect(Number(completionList.getAttribute("data-anchor-line"))).toBeGreaterThan(0);
    expect(Number(completionList.getAttribute("data-anchor-column"))).toBeGreaterThan(0);
    caretRectSpy.mockRestore();
  });

  it("positions code completion with clamped and flipped viewport edges", async () => {
    const restoreViewport = mockViewportSize(520, 500);
    const caretRectSpy = mockEditorCaretRect({ top: 420, left: 500, bottom: 444, right: 501 });
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    const completionList = await screen.findByRole("listbox", { name: "Code Completion" });

    expect(completionList).toHaveAttribute("data-anchor", "editor-caret");
    expect(completionList).toHaveStyle({ top: "76px", left: "48px" });
    expect(Number(completionList.getAttribute("data-anchor-line"))).toBeGreaterThan(0);
    expect(Number(completionList.getAttribute("data-anchor-column"))).toBeGreaterThan(0);
    caretRectSpy.mockRestore();
    restoreViewport();
  });

  it("positions code completion at the fallback when the caret is unmeasured", async () => {
    const caretRectSpy = mockEditorCaretRect(null);
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    const completionList = await screen.findByRole("listbox", { name: "Code Completion" });

    expect(completionList).toHaveAttribute("data-anchor", "fallback");
    expect(completionList).toHaveStyle({ top: "96px", left: "280px" });
    expect(Number(completionList.getAttribute("data-anchor-line"))).toBeGreaterThan(0);
    expect(Number(completionList.getAttribute("data-anchor-column"))).toBeGreaterThan(0);
    caretRectSpy.mockRestore();
  });

  it("keeps fallback code completion inside narrow viewports", async () => {
    const restoreViewport = mockViewportSize(320, 500);
    const caretRectSpy = mockEditorCaretRect(null);
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    const completionList = await screen.findByRole("listbox", { name: "Code Completion" });

    expect(completionList).toHaveAttribute("data-anchor", "fallback");
    expect(completionList).toHaveStyle({ top: "96px", left: "12px" });
    caretRectSpy.mockRestore();
    restoreViewport();
  });

  it("accepts the top auto-opened completion with Tab while keeping editor focus", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    await waitFor(() => {
      expect(workspaceApi.completeSymbol).toHaveBeenCalled();
    });
    expect(await screen.findByRole("listbox", { name: "Code Completion" })).toBeVisible();
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard("{Tab}");

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}build()");
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("moves the auto-opened completion selection with ArrowDown and accepts the highlighted item", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    const results = await screen.findByRole("listbox", { name: "Code Completion" });
    const buildButton = within(results).getByRole("option", { name: /build\(\)/ });
    const browseButton = within(results).getByRole("option", { name: /browse\(\)/ });

    expect(buildButton).toHaveAttribute("aria-selected", "true");
    expect(browseButton).toHaveAttribute("aria-selected", "false");
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard("{ArrowDown}");

    expect(buildButton).toHaveAttribute("aria-selected", "false");
    expect(browseButton).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}browse()");
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("cycles completion selection and supports page and boundary navigation keys", async () => {
    const user = userEvent.setup();
    const completionItems = Array.from({ length: 12 }, (_, index) => ({
      label: `item${String(index + 1).padStart(2, "0")}()`,
      detail: `Completion item ${index + 1}`,
      kind: "function",
    }));
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => completionItems),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}i");

    const results = await screen.findByRole("listbox", { name: "Code Completion" });
    const item01 = within(results).getByRole("option", { name: /item01\(\)/ });
    const item06 = within(results).getByRole("option", { name: /item06\(\)/ });
    const item07 = within(results).getByRole("option", { name: /item07\(\)/ });
    const item12 = within(results).getByRole("option", { name: /item12\(\)/ });

    expect(item01).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard("{ArrowUp}");
    expect(item12).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(item01).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{PageDown}");
    expect(item07).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(item12).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{PageUp}");
    expect(item06).toHaveAttribute("aria-selected", "true");
    expect(results).toHaveAttribute("aria-activedescendant", item06.id);
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("closes completion with Escape without moving focus out of the editor", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    expect(await screen.findByRole("listbox", { name: "Code Completion" })).toBeVisible();
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}b");
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("opens manual completion in the editor popup instead of the old overlay", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function" },
        { label: "button()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.keyboard("{Control>} {/Control}");

    await waitFor(() => {
      expect(workspaceApi.completeSymbol).toHaveBeenCalledWith(expect.objectContaining({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 3,
        column: 16,
        content: expect.stringContaining("struct Index"),
      }));
    });

    const results = await screen.findByRole("listbox", { name: "Code Completion" });
    expect(results).toBeVisible();
    const buildOption = within(results).getByRole("option", { name: /build\(\)/ });
    expect(buildOption).toBeVisible();
    expect(within(results).getByRole("option", { name: /browse\(\)/ })).toBeVisible();

    await waitFor(() => expect(editor).toHaveFocus());
    await user.click(buildOption);

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}build()");
  });

  it("keeps completion items when the query matches filter text", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        {
          label: "setWidth(value)",
          detail: "ArkUI universal attribute",
          kind: "method",
          filterText: "width",
          source: "arkui" as const,
        },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}wi");

    const results = await screen.findByRole("listbox", { name: "Code Completion" });

    expect(within(results).getByRole("option", { name: /setWidth\(value\)/ })).toBeVisible();
  });

  it("prioritizes the most recently accepted completion item on the next matching query", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "broker()", detail: "Semantic workspace function", kind: "function" },
        { label: "browse()", detail: "Semantic workspace function", kind: "function", insertText: "browse(${1:value})" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}b");

    await screen.findByRole("listbox", { name: "Code Completion" });
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}browse(value)");

    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
    await user.keyboard("b");

    const secondResults = await screen.findByRole("listbox", { name: "Code Completion" });
    const resultButtons = within(secondResults).getAllByRole("option");

    expect(resultButtons[0]).toHaveTextContent("browse()");
    expect(within(secondResults).getByRole("option", { name: /browse\(\)/ })).toHaveAttribute("aria-selected", "true");
    expect(within(secondResults).getByRole("option", { name: /broker\(\)/ })).toHaveAttribute("aria-selected", "false");
  });

  it("keeps the closer prefix match ahead of a merely recent completion item", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
        { label: "button()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}bu");

    await screen.findByRole("listbox", { name: "Code Completion" });
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}button()");

    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
    await user.keyboard("bu");

    const secondResults = await screen.findByRole("listbox", { name: "Code Completion" });
    const resultButtons = within(secondResults).getAllByRole("option");

    expect(resultButtons[0]).toHaveTextContent("build()");
    expect(within(secondResults).getByRole("option", { name: /build\(\)/ })).toHaveAttribute("aria-selected", "true");
    expect(within(secondResults).getByRole("option", { name: /button\(\)/ })).toHaveAttribute("aria-selected", "false");
  });

  it("prefers the earlier contains-match position over a merely recent non-prefix completion", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      completeSymbol: vi.fn(async () => [
        { label: "outline()", detail: "Semantic workspace function", kind: "function" },
        { label: "myLine()", detail: "Semantic workspace function", kind: "function" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}li");

    const firstResults = await screen.findByRole("listbox", { name: "Code Completion" });
    await user.click(within(firstResults).getByRole("option", { name: /outline\(\)/ }));

    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}outline()");
    expect(screen.queryByRole("listbox", { name: "Code Completion" })).not.toBeInTheDocument();
    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
    await user.keyboard("li");

    const secondResults = await screen.findByRole("listbox", { name: "Code Completion" });
    const resultButtons = within(secondResults).getAllByRole("option");

    expect(resultButtons[0]).toHaveTextContent("myLine()");
    expect(within(secondResults).getByRole("option", { name: /myLine\(\)/ })).toHaveAttribute("aria-selected", "true");
    expect(within(secondResults).getByRole("option", { name: /outline\(\)/ })).toHaveAttribute("aria-selected", "false");
  });

  it("finds usages from the editor and opens the selected result", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [
          "C:/samples/DemoWorkspace/src/main.ets",
          "C:/samples/DemoWorkspace/AppScope/app.json5",
        ],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [
          "C:/samples/DemoWorkspace/src/main.ets",
          "C:/samples/DemoWorkspace/AppScope/app.json5",
        ],
      }),
      openFile: vi.fn(async (path: string) => path.endsWith("app.json5")
        ? "{\n  \"app\": {\n    \"bundleName\": \"com.demo.app\"\n  }\n}"
        : "@Entry\n@Component\nstruct Index {}"),
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      findUsages: vi.fn(async () => [
        {
          path: "C:/samples/DemoWorkspace/AppScope/app.json5",
          line: 2,
          column: 3,
          preview: "\"app\": {",
        },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.keyboard("{Alt>}{F7}{/Alt}");

    await waitFor(() => {
      expect(workspaceApi.findUsages).toHaveBeenCalledWith(expect.objectContaining({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 1,
        column: 1,
        content: expect.stringContaining("struct Index"),
      }));
    });

    expect(screen.queryByRole("tab", { name: "Usages" })).not.toBeInTheDocument();
    const queryPanel = await screen.findByLabelText("Editor Query Panel");
    expect(within(queryPanel).getByText("Usages (1)")).toBeVisible();
    const usagesPanel = within(queryPanel).getByLabelText("Usages Panel");
    await user.click(within(usagesPanel).getByRole("button", { name: /AppScope[\\/]app\.json5/ }));

    await waitFor(() => {
      expect(workspaceApi.openFile).toHaveBeenLastCalledWith("C:/samples/DemoWorkspace/AppScope/app.json5");
    });
    expect(await screen.findByLabelText("Editor Content")).toHaveTextContent("\"bundleName\": \"com.demo.app\"");
  });

  it("shows ambiguous fallback definition candidates in the usages panel", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [
          "C:/samples/DemoWorkspace/src/main.ets",
          "C:/samples/DemoWorkspace/src/entryability/EntryAbility.ets",
          "C:/samples/DemoWorkspace/src/mock/EntryAbility.ets",
        ],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [
          "C:/samples/DemoWorkspace/src/main.ets",
          "C:/samples/DemoWorkspace/src/entryability/EntryAbility.ets",
          "C:/samples/DemoWorkspace/src/mock/EntryAbility.ets",
        ],
      }),
      openFile: vi.fn(async (path: string) => {
        if (/src[\\/]main\.ets$/i.test(path)) {
          return "EntryAbility();\n";
        }
        if (/src[\\/]entryability[\\/]EntryAbility\.ets$/i.test(path)) {
          return "export function EntryAbility() {}\n";
        }
        if (/src[\\/]mock[\\/]EntryAbility\.ets$/i.test(path)) {
          return "export function EntryAbility() {}\n";
        }

        return "";
      }),
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      gotoDefinition: vi.fn(async () => null),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(0);
    fireEvent.mouseDown(editor, {
      ctrlKey: true,
      button: 0,
      clientX: 24,
      clientY: 24,
    });

    await waitFor(() => {
      expect(workspaceApi.gotoDefinition).toHaveBeenCalled();
    });
    const queryPanel = await screen.findByLabelText("Editor Query Panel");
    expect(within(queryPanel).getByText("Usages (2)")).toBeVisible();
    const usagesPanel = within(queryPanel).getByLabelText("Usages Panel");
    await waitFor(() => {
      expect(within(usagesPanel).getByRole("button", { name: /entryability[\\/]EntryAbility\.ets/i })).toBeVisible();
      expect(within(usagesPanel).getByRole("button", { name: /mock[\\/]EntryAbility\.ets/i })).toBeVisible();
    });
    expect(
      within(usagesPanel).getByRole("button", { name: /mock[\\/]EntryAbility\.ets/i }),
    ).toHaveTextContent("export function EntryAbility() {}");

    await user.click(within(usagesPanel).getByRole("button", { name: /mock[\\/]EntryAbility\.ets/i }));

    await waitFor(() => {
      expect(workspaceApi.openFile).toHaveBeenLastCalledWith("C:\\samples\\DemoWorkspace\\src\\mock\\EntryAbility.ets");
    });
    posAtCoords.mockRestore();
  });

  it("shows semantic definition candidates in the usages panel through the shared path", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [
          "C:/samples/DemoWorkspace/src/main.ets",
          "C:/samples/DemoWorkspace/src/entryability/EntryAbility.ets",
          "C:/samples/DemoWorkspace/src/mock/EntryAbility.ets",
        ],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [
          "C:/samples/DemoWorkspace/src/main.ets",
          "C:/samples/DemoWorkspace/src/entryability/EntryAbility.ets",
          "C:/samples/DemoWorkspace/src/mock/EntryAbility.ets",
        ],
      }),
      openFile: vi.fn(async (path: string) => {
        if (/src[\\/]main\.ets$/i.test(path)) {
          return "EntryAbility();\n";
        }
        if (/src[\\/]entryability[\\/]EntryAbility\.ets$/i.test(path)) {
          return "export function EntryAbility() {}\n";
        }
        if (/src[\\/]mock[\\/]EntryAbility\.ets$/i.test(path)) {
          return "export function EntryAbility() {}\n";
        }

        return "";
      }),
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      gotoDefinition: vi.fn(async () => null),
      gotoDefinitionCandidates: vi.fn(async () => [
        {
          path: "C:\\samples\\DemoWorkspace\\src\\entryability\\EntryAbility.ets",
          line: 1,
          column: 17,
          preview: "export function EntryAbility() {}",
        },
        {
          path: "C:\\samples\\DemoWorkspace\\src\\mock\\EntryAbility.ets",
          line: 1,
          column: 17,
          preview: "export function EntryAbility() {}",
        },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    } as Partial<WorkspaceApi>);

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(0);
    fireEvent.mouseDown(editor, {
      ctrlKey: true,
      button: 0,
      clientX: 24,
      clientY: 24,
    });

    await waitFor(() => {
      expect(workspaceApi.gotoDefinitionCandidates).toHaveBeenCalled();
    });
    const queryPanel = await screen.findByLabelText("Editor Query Panel");
    expect(within(queryPanel).getByText("Usages (2)")).toBeVisible();
    const usagesPanel = within(queryPanel).getByLabelText("Usages Panel");
    expect(within(usagesPanel).getByRole("button", { name: /mock[\\/]EntryAbility\.ets/i })).toBeVisible();
    posAtCoords.mockRestore();
  });

  it("shows recent files in most-recent-first order from the keyboard", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByRole("button", { name: "app.json5" }));
    await user.keyboard("{Control>}e{/Control}");

    const results = await screen.findByRole("list", { name: "Recent Files Results" });
    const items = within(results).getAllByRole("button");

    expect(items[0]).toHaveTextContent("app.json5");
    expect(items[1]).toHaveTextContent("main.ets");
  });

  it("marks edited files dirty and clears the marker on save", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("{End}\n// edit");

    const dirtyTab = screen.getByRole("button", { name: "main.ets", pressed: true });
    expect(dirtyTab).toBeVisible();
    expect(dirtyTab.querySelector(".editor-tab__dirty")).not.toBeNull();

    await user.keyboard("{Control>}s{/Control}");
    const cleanTab = screen.getByRole("button", { name: "main.ets", pressed: true });
    expect(cleanTab).toBeVisible();
    expect(cleanTab.querySelector(".editor-tab__dirty")).toBeNull();
  });

  it("saves through the workspace api and refreshes lint/format problems", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: vi.fn(async () => undefined),
      runValidation: async () => [
        {
          source: "lint",
          severity: "error",
          path: "C:/samples/DemoWorkspace/src/main.ets",
          line: 3,
          column: 1,
          message: "Expected trailing semicolon",
        },
        {
          source: "format",
          severity: "warning",
          path: "C:/samples/DemoWorkspace/src/main.ets",
          line: 1,
          column: 1,
          message: "File is not formatted",
        },
      ],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("!");
    await user.keyboard("{Control>}s{/Control}");

    expect(workspaceApi.saveFile).toHaveBeenCalledTimes(1);
    expect(workspaceApi.saveFile).toHaveBeenCalledWith(
      "C:\\samples\\DemoWorkspace\\src\\main.ets",
      expect.stringContaining("!"),
    );
    expect(await screen.findByText("Expected trailing semicolon")).toBeVisible();
    expect(screen.getByText("File is not formatted")).toBeVisible();
  });

  it("loads diff content into the review panel", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => `diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,1 @@
-old
+new`,
      inspectEnvironment: async () => ({ tools: [] }),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);
    const header = screen.getByRole("banner", { name: "Application Header" });
    await user.click(within(header).getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Git" }));

    expect(await screen.findByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("button", { name: "src/main.ets M Modified" })).toBeVisible();
    expect(screen.getByLabelText("Git Diff Viewer")).toBeVisible();
    expect(screen.getByText("+ new")).toBeVisible();
    expect(screen.getByText("- old")).toBeVisible();
  });

  it("opens Git Trace for the current file and shows commit summary details", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      getFileBlame: async () => [
        {
          line: 1,
          commit: "abc1234",
          sourceLine: 1,
          author: "Jane Doe",
          authoredAt: "2026-06-23T10:00:00Z",
          relativeTime: "2h ago",
          summary: "Mark ArkTS entry component",
        },
      ],
      getCommitTrace: async () => ({
        commit: "abc1234",
        shortCommit: "abc1234",
        author: "Jane Doe",
        email: "jane@example.com",
        authoredAt: "2026-06-23T10:00:00Z",
        subject: "Mark ArkTS entry component",
        relativePath: "src/main.ets",
        selectedLine: 1,
        sourceLine: 1,
        patch: `diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,2 @@
 @Entry
+@Component`,
      }),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(screen.getByRole("tab", { name: "Git" }));
    await user.click(screen.getByRole("tab", { name: "Line Trace" }));

    const panel = await screen.findByLabelText("Git Trace Panel");
    expect(within(panel).getByText("Mark ArkTS entry component")).toBeVisible();
    expect(within(panel).getByText("abc1234")).toBeVisible();
    expect(within(panel).getByText(/Jane Doe/)).toBeVisible();
    expect(within(panel).getByText("File").parentElement).toHaveTextContent("src/main.ets");
    expect(within(panel).getByRole("heading", { name: "Commit" })).toBeVisible();
    expect(within(panel).getByRole("heading", { name: "Actions" })).toBeVisible();
    expect(within(panel).getByRole("heading", { name: "Diff Preview" })).toBeVisible();
  });

  it("opens Git Trace from an inline blame label click", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n@Component\nstruct Index {}",
      getFileBlame: async () => [
        {
          line: 1,
          commit: "abc1234",
          sourceLine: 1,
          author: "Jane Doe",
          authoredAt: "2026-06-23T10:00:00Z",
          relativeTime: "2h ago",
          summary: "Mark ArkTS entry component",
        },
      ],
      getCommitTrace: async () => ({
        commit: "abc1234",
        shortCommit: "abc1234",
        author: "Jane Doe",
        email: "jane@example.com",
        authoredAt: "2026-06-23T10:00:00Z",
        subject: "Mark ArkTS entry component",
        relativePath: "src/main.ets",
        selectedLine: 1,
        sourceLine: 1,
        patch: `diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,2 @@
 @Entry
+@Component`,
      }),
    });

    const { container } = render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByRole("button", { name: "Blame actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Toggle Git Blame" }));
    const blameButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(".cm-git-trace-marker");
      expect(button).toBeTruthy();
      return button!;
    });
    expect(blameButton).toHaveAttribute(
      "aria-label",
      "Git Trace Line 1 Jane Doe 2h ago Mark ArkTS entry component",
    );
    await user.click(blameButton);

    expect(await screen.findByRole("dialog", { name: "Git Blame Details" })).toHaveTextContent("Mark ArkTS entry component");
    expect(screen.queryByRole("tab", { name: "Git Trace" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "false");

    await user.click(screen.getByRole("button", { name: "Show Commit" }));

    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Line Trace" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Git Trace Panel")).toHaveTextContent("Mark ArkTS entry component");
  });

  it("copies a committed blame hash from the blame card", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry",
      getFileBlame: async () => [
        {
          line: 1,
          commit: "abc1234567890",
          sourceLine: 1,
          author: "Jane Doe",
          authoredAt: "2026-06-23T10:00:00Z",
          relativeTime: "2h ago",
          summary: "Mark ArkTS entry component",
        },
      ],
    });

    const { container } = render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByRole("button", { name: "Blame actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Toggle Git Blame" }));
    const blameButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>(".cm-git-trace-marker");
      expect(button).toBeTruthy();
      return button!;
    });
    await user.click(blameButton);
    await user.click(await screen.findByRole("button", { name: "Copy Hash" }));

    expect(writeText).toHaveBeenCalledWith("abc1234567890");
    expect(await screen.findByText("Copied commit abc1234")).toBeVisible();
  });

  it("keeps committed blame visible around an unsaved inserted line", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\nbuild() {}\nText('Hi')",
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
        {
          line: 2,
          commit: "bbb2222",
          sourceLine: 2,
          author: "Alex Chen",
          authoredAt: "2026-06-21T10:00:00Z",
          relativeTime: "3d ago",
          summary: "Add build method",
        },
        {
          line: 3,
          commit: "ccc3333",
          sourceLine: 3,
          author: "Mina Park",
          authoredAt: "2026-06-22T10:00:00Z",
          relativeTime: "2d ago",
          summary: "Add text widget",
        },
      ],
    });

    const { container } = render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("{Home}{ArrowDown}{Enter}@Component");
    await user.click(screen.getByRole("button", { name: "Blame actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Toggle Git Blame" }));

    await waitFor(() => {
      expect(container.querySelector(".cm-git-trace-marker")).toBeTruthy();
    });

    expect(container).toHaveTextContent("Uncommitted");
    expect(container).toHaveTextContent("Jane Doe");
    expect(container).toHaveTextContent("Alex Chen");
  });

  it("opens the Git diff view for a local uncommitted blame row", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\nbuild() {}",
      loadDiff: async () => `diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,2 @@
 @Entry
+// local change`,
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
        {
          line: 2,
          commit: "bbb2222",
          sourceLine: 2,
          author: "Alex Chen",
          authoredAt: "2026-06-21T10:00:00Z",
          relativeTime: "3d ago",
          summary: "Add build method",
        },
      ],
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Home}{Enter}// local change");
    await user.click(await screen.findByRole("button", { name: "Blame actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Show Current Line Commit" }));

    expect(await screen.findByRole("dialog", { name: "Git Blame Details" })).toHaveTextContent("Local uncommitted change");
    expect(screen.queryByRole("button", { name: "Copy Hash" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Local Diff" }));

    expect(await screen.findByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("tab", { name: "Local Changes" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Git Diff Viewer")).toHaveTextContent("+ // local change");
    expect(screen.queryByRole("dialog", { name: "Git Blame Details" })).not.toBeInTheDocument();
  });

  it("shows current-line blame while full-file blame is closed", async () => {
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
        {
          line: 2,
          commit: "aaa1111",
          sourceLine: 2,
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

    expect(await screen.findByText("Blame: Jane Doe, 4d ago")).toBeVisible();
    expect(container.querySelector(".cm-git-trace-marker")).toBeNull();
  });

  it("toggles full-file Git Blame without closing the bottom tool window", async () => {
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
    await user.click(screen.getByRole("tab", { name: "Terminal" }));
    await user.click(await screen.findByRole("button", { name: "Blame actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Toggle Git Blame" }));

    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(container.querySelector(".cm-git-trace-marker")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Blame actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Toggle Git Blame" }));

    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(container.querySelector(".cm-git-trace-marker")).toBeNull();
  });

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

  it("closes the blame menu and card with Escape before broader UI handling", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry",
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
    await user.click(await screen.findByRole("button", { name: "Blame actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Show Current Line Commit" }));
    expect(await screen.findByRole("dialog", { name: "Git Blame Details" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Blame actions" }));
    expect(await screen.findByRole("menu", { name: "Git Blame Actions" })).toBeVisible();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu", { name: "Git Blame Actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Git Blame Details" })).toBeVisible();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Git Blame Details" })).not.toBeInTheDocument();
  });

  it("refreshes Git Blame after saving without blocking save", async () => {
    const user = userEvent.setup();
    const getFileBlame = vi.fn()
      .mockResolvedValueOnce([
        {
          line: 1,
          commit: "aaa1111",
          sourceLine: 1,
          author: "Jane Doe",
          authoredAt: "2026-06-20T10:00:00Z",
          relativeTime: "4d ago",
          summary: "Add entry component",
        },
      ])
      .mockResolvedValue([
        {
          line: 1,
          commit: "bbb2222",
          sourceLine: 1,
          author: "Alex Chen",
          authoredAt: "2026-06-24T10:00:00Z",
          relativeTime: "now",
          summary: "Refresh saved entry",
        },
      ]);
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry",
      saveFile: vi.fn(async () => undefined),
      getFileBlame,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    expect(await screen.findByText("Blame: Jane Doe, 4d ago")).toBeVisible();

    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("!");
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => expect(workspaceApi.saveFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getFileBlame).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Blame: Alex Chen, now")).toBeVisible();
  });

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
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("menuitem", { name: "Command Palette" }));
    fireEvent.change(await screen.findByLabelText("Find Action Query"), { target: { value: "Toggle Git Blame" } });
    await user.click(await screen.findByRole("button", { name: "Toggle Git Blame" }));

    await waitFor(() => expect(container.querySelector(".cm-git-trace-marker")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("menuitem", { name: "Command Palette" }));
    fireEvent.change(await screen.findByLabelText("Find Action Query"), { target: { value: "Show Current Line Git Blame" } });
    await user.click(await screen.findByRole("button", { name: "Show Current Line Git Blame" }));

    expect(await screen.findByRole("dialog", { name: "Git Blame Details" })).toHaveTextContent("Add entry component");
  });

  it("shows a clear message when the file is not tracked by Git", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      getFileBlame: async () => ({
        kind: "unavailable",
        reason: "notTracked",
        message: "File is not tracked by Git",
      }),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(screen.getByRole("tab", { name: "Git" }));
    await user.click(screen.getByRole("tab", { name: "Line Trace" }));

    expect(await screen.findByLabelText("Git Trace Panel")).toHaveTextContent("File is not tracked by Git");
  });

  it("shows a clear message when Git is unavailable", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      getFileBlame: async () => ({
        kind: "unavailable",
        reason: "gitUnavailable",
        message: "Git is unavailable on this machine",
      }),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(screen.getByRole("tab", { name: "Git" }));
    await user.click(screen.getByRole("tab", { name: "Line Trace" }));

    expect(await screen.findByLabelText("Git Trace Panel")).toHaveTextContent("Git is unavailable on this machine");
  });

  it("keeps Git Trace available after unsaved edits", async () => {
    const user = userEvent.setup();
    const getFileBlame = vi.fn(async () => [
      {
        line: 1,
        commit: "abc1234",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-23T10:00:00Z",
        relativeTime: "2h ago",
        summary: "Mark ArkTS entry component",
      },
    ]);
    const workspaceApi = createWorkspaceApi({
      getFileBlame,
      getCommitTrace: async () => ({
        commit: "abc1234",
        shortCommit: "abc1234",
        author: "Jane Doe",
        email: "jane@example.com",
        authoredAt: "2026-06-23T10:00:00Z",
        subject: "Mark ArkTS entry component",
        relativePath: "src/main.ets",
        selectedLine: 1,
        sourceLine: 1,
        patch: "diff --git a/src/main.ets b/src/main.ets\n+@Entry",
      }),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{End}\n// dirty");
    await user.click(screen.getByRole("tab", { name: "Git" }));
    await user.click(screen.getByRole("tab", { name: "Line Trace" }));

    expect(await screen.findByLabelText("Git Trace Panel")).toHaveTextContent("Mark ArkTS entry component");
    expect(getFileBlame).toHaveBeenCalledTimes(1);
  });

  it("formats the active document from the top bar", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "@Entry\n\t@Component  \nstruct Index {}",
      saveFile: async () => undefined,
      runValidation: async (_path, content) => {
        const problems = [];
        if (content.includes("\t")) {
          problems.push({
            source: "format" as const,
            severity: "warning" as const,
            path: "C:/samples/DemoWorkspace/src/main.ets",
            line: 2,
            column: 1,
            message: "Replace tabs with spaces",
          });
        }
        return problems;
      },
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(within(header).getByRole("button", { name: "Run Lint" }));
    expect(await screen.findByText("Replace tabs with spaces")).toBeVisible();

    await user.click(within(header).getByRole("button", { name: "Format" }));

    expect(screen.queryByText("Replace tabs with spaces")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Editor Content")).toHaveTextContent("@Component");
  });

  it("opens settings and shows environment status", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByLabelText("Settings")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    expect(await screen.findByLabelText("Environment Status")).toBeVisible();
    expect(screen.getByLabelText("HarmonyOS / ArkTS SDK Path")).toBeVisible();
    expect(screen.getByText("Bundled ripgrep not configured yet")).toBeVisible();
  });

  it("shows a searchable read-only keymap in settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(await screen.findByRole("tab", { name: "Keymap" }));

    expect(await screen.findByLabelText("Keyboard Shortcuts Settings")).toBeVisible();
    expect(screen.getByRole("row", { name: /Go to Definition Navigation/i })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+B$/)).toBeVisible();
    expect(screen.getAllByText("Default").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Search Keyboard Shortcuts"), "completion");

    expect(screen.getByRole("row", { name: /Code Completion Editor .+ Default Active/i })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Space$/)).toBeVisible();
    expect(screen.queryByRole("row", { name: /Go to Definition Navigation/i })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search Keyboard Shortcuts"));
    await user.type(screen.getByLabelText("Search Keyboard Shortcuts"), "Alt+F7");

    expect(screen.getByRole("row", { name: /Find Usages Navigation/i })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Code Completion Editor/i })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search Keyboard Shortcuts"));
    await user.type(screen.getByLabelText("Search Keyboard Shortcuts"), "Shift+F");

    expect(screen.getByRole("row", { name: /Find in Files Navigation/i })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Shift\+F$/)).toBeVisible();

    await user.clear(screen.getByLabelText("Search Keyboard Shortcuts"));
    await user.type(screen.getByLabelText("Search Keyboard Shortcuts"), "Shift+R");

    expect(screen.getByRole("row", { name: /Replace in Files Navigation/i })).toBeVisible();
    expect(screen.getByText(/^(Ctrl|Cmd)\+Shift\+R$/)).toBeVisible();
  });

  it("warns about suspicious SDK paths without blocking Apply", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async () => undefined);
    const workspaceApi = createWorkspaceApi({ saveSettings });

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    const sdkPath = await screen.findByLabelText("HarmonyOS / ArkTS SDK Path");
    const nodePath = screen.getByLabelText("Node Path");

    expect(sdkPath).toHaveAttribute("aria-describedby", "harmony-sdk-path-hint");
    expect(nodePath).toHaveAttribute("aria-describedby", "node-path-hint");
    expect(screen.getByText("ArkLine will resolve node from PATH.")).toHaveAttribute("id", "node-path-hint");

    await user.clear(sdkPath);
    await user.type(sdkPath, "Z:/missing-sdk");

    expect(screen.getByText(/SDK path has not been verified yet/i)).toHaveAttribute("id", "harmony-sdk-path-hint");
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
  });

  it("uses a directory picker for Node Path", async () => {
    const user = userEvent.setup();
    const pickPath = vi.fn(async () => "C:/Program Files/nodejs");
    const workspaceApi = createWorkspaceApi({ pickPath });

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    await user.click(screen.getByRole("button", { name: "Browse Node Path" }));

    expect(pickPath).toHaveBeenCalledWith({
      directory: true,
      title: "Select Node Directory",
    });
  });

  it("keeps settings edits as a draft until Apply and discards them on Cancel", async () => {
    const user = userEvent.setup();
    const savedSettings = defaultSettings();
    const saveSettings = vi.fn(async () => undefined);
    const workspaceApi = createWorkspaceApi({
      loadSettings: async () => savedSettings,
      saveSettings,
      inspectEnvironment: vi.fn(async () => ({ tools: [] })),
      inspectLanguageService: vi.fn(async () => ({
        provider: "mock-fallback",
        mode: "fallback" as const,
        running: true,
        hover: true,
        definition: true,
        completion: true,
        documentSymbols: true,
        findUsages: true,
        detail: "ready",
      })),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Editor" }));
    const fontSize = await screen.findByLabelText("Font Size");
    await user.clear(fontSize);
    await user.type(fontSize, "18");

    expect(saveSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "Editor" }));

    expect(await screen.findByLabelText("Font Size")).toHaveValue(14);

    await user.clear(screen.getByLabelText("Font Size"));
    await user.type(screen.getByLabelText("Font Size"), "17");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenLastCalledWith({
      ...savedSettings,
      editor: {
        ...savedSettings.editor,
        fontSize: 17,
      },
    });
  });

  it("reports apply failure when semantic refresh fails", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async () => undefined);
    const inspectLanguageService = vi.fn(async () => {
      throw new Error("semantic refresh failed");
    });
    const workspaceApi = createWorkspaceApi({
      saveSettings,
      inspectEnvironment: vi.fn(async () => ({ tools: [] })),
      inspectLanguageService,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    await user.clear(await screen.findByLabelText("HarmonyOS / ArkTS SDK Path"));
    await user.type(screen.getByLabelText("HarmonyOS / ArkTS SDK Path"), "D:/HarmonyOS/Sdk");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(await screen.findByText("SDK settings apply failed: semantic refresh failed")).toBeVisible();
    expect(screen.queryByText("SDK settings applied")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Applying..." })).not.toBeInTheDocument();
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(inspectLanguageService).toHaveBeenCalled();
  });

  it("keeps the settings dialog locked while apply refresh is still running", async () => {
    const user = userEvent.setup();
    let finishEnvironment!: () => void;
    const saveSettings = vi.fn(async () => undefined);
    const inspectEnvironment = vi.fn(() => new Promise<{ tools: [] }>((resolve) => {
      finishEnvironment = () => resolve({ tools: [] });
    }));
    const inspectLanguageService = vi.fn(async () => ({
      provider: "mock-fallback",
      mode: "fallback" as const,
      running: true,
      hover: true,
      definition: true,
      completion: true,
      documentSymbols: true,
      findUsages: true,
      detail: "ready",
    }));
    const workspaceApi = createWorkspaceApi({
      saveSettings,
      inspectEnvironment,
      inspectLanguageService,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    await user.clear(await screen.findByLabelText("HarmonyOS / ArkTS SDK Path"));
    await user.type(screen.getByLabelText("HarmonyOS / ArkTS SDK Path"), "D:/HarmonyOS/Sdk");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(inspectEnvironment).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Applying..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close Settings" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByText("SDK settings applying...")).toBeVisible();

    finishEnvironment();

    await waitFor(() => expect(screen.getByText("SDK settings applied")).toBeVisible());
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(inspectLanguageService).toHaveBeenCalled();
  });

  it("closes Settings from the backdrop when idle but keeps it open while applying", async () => {
    const user = userEvent.setup();
    let finishEnvironment!: () => void;
    const saveSettings = vi.fn(async () => undefined);
    const inspectEnvironment = vi.fn(() => new Promise<{ tools: [] }>((resolve) => {
      finishEnvironment = () => resolve({ tools: [] });
    }));
    const workspaceApi = createWorkspaceApi({
      saveSettings,
      inspectEnvironment,
      inspectLanguageService: vi.fn(async () => ({
        provider: "mock-fallback",
        mode: "fallback" as const,
        running: true,
        hover: true,
        definition: true,
        completion: true,
        documentSymbols: true,
        findUsages: true,
        detail: "ready",
      })),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    const idleDialog = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.mouseDown(idleDialog);
    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    await user.clear(await screen.findByLabelText("HarmonyOS / ArkTS SDK Path"));
    await user.type(screen.getByLabelText("HarmonyOS / ArkTS SDK Path"), "D:/HarmonyOS/Sdk");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(inspectEnvironment).toHaveBeenCalled());
    const applyingDialog = screen.getByRole("dialog", { name: "Settings" });
    fireEvent.mouseDown(applyingDialog);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Close Settings" })).toBeDisabled();

    finishEnvironment();
    await waitFor(() => expect(screen.getByText("SDK settings applied")).toBeVisible());
  });

  it("loads persisted settings and saves updates through the workspace api", async () => {
    const user = userEvent.setup();
    const settings = defaultSettings();
    const pickPath = vi.fn(async ({ title }: { title: string }) =>
      title.includes("HarmonyOS") ? "E:/HarmonyOS/Sdk" : null,
    );
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [],
      }),
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: [],
      }),
      openFile: async () => "",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      loadSettings: async () => ({
        ...settings,
        editor: {
          ...settings.editor,
          fontSize: 15,
          letterSpacing: 0.1,
        },
        sdk: {
          ...settings.sdk,
          harmonySdkPath: "C:/HarmonyOS/Sdk",
        },
      }),
      pickPath,
      saveSettings: vi.fn(async () => undefined),
    });

    render(<AppShell workspaceApi={workspaceApi} />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(screen.getByRole("tab", { name: "Editor" }));
    const fontSize = await screen.findByLabelText("Font Size");
    await user.clear(fontSize);
    await user.type(fontSize, "16");
    const letterSpacing = screen.getByLabelText("Letter Spacing");
    await user.clear(letterSpacing);
    await user.type(letterSpacing, "0.25");
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    const sdkPath = await screen.findByLabelText("HarmonyOS / ArkTS SDK Path");
    await user.clear(sdkPath);
    await user.type(sdkPath, "D:/HarmonyOS/Sdk");
    await user.click(screen.getByRole("button", { name: "Browse HarmonyOS / ArkTS SDK Path" }));
    await user.click(screen.getByRole("tab", { name: "Validation" }));
    const lintCommand = screen.getByLabelText("Lint Command");
    await user.clear(lintCommand);
    await user.type(lintCommand, "custom-lint");

    expect(workspaceApi.saveSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Editor" }));
    expect(screen.getByDisplayValue("16")).toBeVisible();
    expect(screen.getByDisplayValue("0.25")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    expect(screen.getByDisplayValue("E:/HarmonyOS/Sdk")).toBeVisible();
    expect(pickPath).toHaveBeenCalledWith({
      directory: true,
      title: "Select HarmonyOS / ArkTS SDK Path",
    });
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(workspaceApi.saveSettings).toHaveBeenCalledTimes(1));
    expect(workspaceApi.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        editor: expect.objectContaining({ fontSize: 16, letterSpacing: 0.25 }),
        sdk: expect.objectContaining({ harmonySdkPath: "E:/HarmonyOS/Sdk" }),
        validation: expect.objectContaining({ lintCommand: "custom-lint" }),
      }),
    );
  });

  it("supports the approved ArkTS sample workflow across project, git, and editor-only modes", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "ArkDemo",
        rootPath: "C:/samples/ArkDemo",
        files: [
          "C:/samples/ArkDemo/AppScope/app.json5",
          "C:/samples/ArkDemo/entry/src/main/ets/pages/Index.ets",
          "C:/samples/ArkDemo/entry/src/main/ets/entryability/EntryAbility.ets",
          "C:/samples/ArkDemo/entry/src/main/resources/base/element/string.json",
        ],
      }),
      openDemoWorkspace: async () => ({
        rootName: "ArkDemo",
        rootPath: "C:/samples/ArkDemo",
        files: [
          "C:/samples/ArkDemo/AppScope/app.json5",
          "C:/samples/ArkDemo/entry/src/main/ets/pages/Index.ets",
          "C:/samples/ArkDemo/entry/src/main/ets/entryability/EntryAbility.ets",
          "C:/samples/ArkDemo/entry/src/main/resources/base/element/string.json",
        ],
      }),
      openFile: async (path) => {
        if (path.endsWith("Index.ets")) {
          return "@Entry\n@Component\nstruct Index {}";
        }

        if (path.endsWith("EntryAbility.ets")) {
          return "export default class EntryAbility {}";
        }

        if (path.endsWith("string.json")) {
          return "{\n  \"hello\": \"ArkLine\"\n}";
        }

        return "{\n  \"app\": {}\n}";
      },
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => `diff --git a/entry/src/main/ets/pages/Index.ets b/entry/src/main/ets/pages/Index.ets
--- a/entry/src/main/ets/pages/Index.ets
+++ b/entry/src/main/ets/pages/Index.ets
@@ -1,1 +1,2 @@
-struct Index {}
+struct Index {
+}`,
      inspectEnvironment: async () => ({ tools: [] }),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await openProject(user, "C:/samples/ArkDemo");

    expect(await screen.findByRole("button", { name: "Index.ets" })).toBeVisible();
    expect(screen.getByRole("button", { name: "EntryAbility.ets" })).toBeVisible();
    expect(screen.getByRole("button", { name: "string.json" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Index.ets" }));
    expect(await screen.findByLabelText("Editor Content")).toHaveTextContent("struct Index {}");

    await user.click(within(header).getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Git" }));
    expect(await screen.findByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /entry\/src\/main\/ets\/pages\/Index\.ets .* Modified/ })).toBeVisible();
    expect(screen.getByText("+ }")).toBeVisible();

    await user.keyboard("{Control>}{Shift>}{F12}{/Shift}{/Control}");
    expect(screen.getByLabelText("Files")).not.toBeVisible();
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByLabelText("Git Panel")).not.toBeVisible();

    await user.keyboard("{Alt>}1{/Alt}");
    expect(screen.getByLabelText("Files")).toBeVisible();

    await user.keyboard("{Alt>}9{/Alt}");
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Git Panel")).toBeVisible();
  });

  it("reopens a workspace from recent projects", async () => {
    const user = userEvent.setup();
    render(<App />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await openProject(user, "C:/samples/ArkDemoWorkspace");
    await openProject(user, "C:/samples/SecondWorkspace");

    await user.click(within(header).getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Recent Projects" }));
    const results = await screen.findByRole("list", { name: "Recent Projects Results" });
    await user.click(within(results).getByRole("button", { name: "ArkDemoWorkspace C:\\samples\\ArkDemoWorkspace" }));
    await user.click(await screen.findByRole("button", { name: "This Window" }));

    expect(await screen.findByText("Workspace: ArkDemoWorkspace")).toBeVisible();
  });

  it("shows a project-open error instead of failing silently", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => {
        throw new Error("Workspace path is not a directory");
      },
      openDemoWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user, "C:/invalid/project");

    expect(await screen.findByText("Workspace path is not a directory")).toBeVisible();
    expect(screen.getByText("Open Project failed: Workspace path is not a directory")).toBeVisible();
  });
});
