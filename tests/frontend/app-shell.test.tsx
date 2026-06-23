import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { AppShell } from "@/components/layout/AppShell";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { defaultSettings } from "@/features/settings/settings-store";
import { EditorView } from "@codemirror/view";
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
  };
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
    expect(screen.getByRole("tab", { name: "Usages" })).toBeInTheDocument();
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

  it("searches workspace text with regex and text options, shows relative paths, previews the selected hit, and opens the file", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Search Everywhere" }));

    const query = await screen.findByLabelText("Search Everywhere Query");
    await user.type(query, "entry");
    expect(within(screen.getByRole("list", { name: "Search Everywhere Results" })).getByText("main.ets")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Aa" }));
    expect(within(screen.getByRole("list", { name: "Search Everywhere Results" })).getByText("No matches")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Aa" }));
    await user.clear(query);
    await user.type(query, "/bundleName/");

    const results = screen.getByRole("list", { name: "Search Everywhere Results" });
    expect(within(results).getByText("app.json5")).toBeVisible();
    expect(within(results).getByText("AppScope/app.json5:3")).toBeVisible();
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
      expect(workspaceApi.gotoDefinition).toHaveBeenCalledWith({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 2,
        column: 1,
      });
    });
    expect(await screen.findByText("Definition: main.ets:3:1")).toBeVisible();
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
        { label: "build()", detail: "Component lifecycle method", kind: "method" },
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
    await user.keyboard("{Control>}{End}{/Control}bu");
    await user.keyboard("{Control>} {/Control}");

    await waitFor(() => {
      expect(workspaceApi.completeSymbol).toHaveBeenLastCalledWith({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 3,
        column: 18,
      });
    });

    const results = await screen.findByRole("list", { name: "Completion Results" });
    const resultButtons = within(results).getAllByRole("button");
    expect(resultButtons[0]).toHaveTextContent("build()");
    expect(within(results).getByRole("button", { name: /sharedSubmit\(\)/ })).toBeVisible();
    await user.click(within(results).getByRole("button", { name: /build\(\)/ }));

    expect(screen.queryByLabelText("Completion Overlay")).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}build()");
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
    expect(await screen.findByLabelText("Completion Overlay")).toBeVisible();
    expect(screen.getByRole("button", { name: /build\(\)/ })).toBeVisible();
    await waitFor(() => expect(editor).toHaveFocus());
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
    expect(await screen.findByLabelText("Completion Overlay")).toBeVisible();
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard("{Tab}");

    expect(screen.queryByLabelText("Completion Overlay")).not.toBeInTheDocument();
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

    const overlay = await screen.findByLabelText("Completion Overlay");
    const results = within(overlay).getByRole("list", { name: "Completion Results" });
    const buildButton = within(results).getByRole("button", { name: /build\(\)/ });
    const browseButton = within(results).getByRole("button", { name: /browse\(\)/ });

    expect(buildButton).toHaveAttribute("aria-selected", "true");
    expect(browseButton).toHaveAttribute("aria-selected", "false");
    await waitFor(() => expect(editor).toHaveFocus());

    await user.keyboard("{ArrowDown}");

    expect(buildButton).toHaveAttribute("aria-selected", "false");
    expect(browseButton).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");

    expect(screen.queryByLabelText("Completion Overlay")).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}browse()");
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("resets the manual completion selection to the first filtered result when the query changes", async () => {
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

    const completionQuery = await screen.findByLabelText("Completion Query");
    const results = await screen.findByRole("list", { name: "Completion Results" });
    await user.click(completionQuery);
    await waitFor(() => expect(completionQuery).toHaveFocus());
    const browseButton = within(results).getByRole("button", { name: /browse\(\)/ });

    await user.keyboard("{ArrowDown}");
    expect(browseButton).toHaveAttribute("aria-selected", "true");

    await user.type(completionQuery, "u");

    const buildButton = within(results).getByRole("button", { name: /build\(\)/ });
    const buttonButton = within(results).getByRole("button", { name: /button\(\)/ });
    expect(buildButton).toHaveAttribute("aria-selected", "true");
    expect(buttonButton).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{Enter}");

    expect(screen.queryByLabelText("Completion Overlay")).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}build()");
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

    await screen.findByLabelText("Completion Overlay");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(screen.queryByLabelText("Completion Overlay")).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}browse()");

    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
    await user.keyboard("b");

    const secondOverlay = await screen.findByLabelText("Completion Overlay");
    const secondResults = within(secondOverlay).getByRole("list", { name: "Completion Results" });
    const resultButtons = within(secondResults).getAllByRole("button");

    expect(resultButtons[0]).toHaveTextContent("browse()");
    expect(within(secondResults).getByRole("button", { name: /browse\(\)/ })).toHaveAttribute("aria-selected", "true");
    expect(within(secondResults).getByRole("button", { name: /broker\(\)/ })).toHaveAttribute("aria-selected", "false");
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

    await screen.findByLabelText("Completion Overlay");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}button()");

    await user.keyboard("{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}");
    await user.keyboard("bu");

    const secondOverlay = await screen.findByLabelText("Completion Overlay");
    const secondResults = within(secondOverlay).getByRole("list", { name: "Completion Results" });
    const resultButtons = within(secondResults).getAllByRole("button");

    expect(resultButtons[0]).toHaveTextContent("build()");
    expect(within(secondResults).getByRole("button", { name: /build\(\)/ })).toHaveAttribute("aria-selected", "true");
    expect(within(secondResults).getByRole("button", { name: /button\(\)/ })).toHaveAttribute("aria-selected", "false");
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

    const firstOverlay = await screen.findByLabelText("Completion Overlay");
    const firstResults = within(firstOverlay).getByRole("list", { name: "Completion Results" });
    await user.click(within(firstResults).getByRole("button", { name: /outline\(\)/ }));

    expect(editor).toHaveTextContent("@Entry@Componentstruct Index {}outline()");
    expect(screen.queryByLabelText("Completion Overlay")).not.toBeInTheDocument();
    await user.keyboard("{Control>} {/Control}");

    const manualOverlay = await screen.findByLabelText("Completion Overlay");
    const completionQuery = await screen.findByLabelText("Completion Query");
    await user.click(completionQuery);
    await user.type(completionQuery, "li");

    const secondResults = within(manualOverlay).getByRole("list", { name: "Completion Results" });
    const resultButtons = within(secondResults).getAllByRole("button");

    expect(resultButtons[0]).toHaveTextContent("myLine()");
    expect(within(secondResults).getByRole("button", { name: /myLine\(\)/ })).toHaveAttribute("aria-selected", "true");
    expect(within(secondResults).getByRole("button", { name: /outline\(\)/ })).toHaveAttribute("aria-selected", "false");
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
      expect(workspaceApi.findUsages).toHaveBeenCalledWith({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 1,
        column: 1,
      });
    });

    expect(await screen.findByRole("tab", { name: "Usages" })).toHaveAttribute("aria-selected", "true");
    const usagesPanel = await screen.findByLabelText("Usages Panel");
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
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Usages" })).toHaveAttribute("aria-selected", "true");
    });
    const usagesPanel = await screen.findByLabelText("Usages Panel");
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
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Usages" })).toHaveAttribute("aria-selected", "true");
    });
    const usagesPanel = await screen.findByLabelText("Usages Panel");
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
    await user.click(screen.getByRole("tab", { name: "Git Trace" }));

    const panel = await screen.findByLabelText("Git Trace Panel");
    expect(within(panel).getByText("Mark ArkTS entry component")).toBeVisible();
    expect(within(panel).getByText("abc1234")).toBeVisible();
    expect(within(panel).getByText(/Jane Doe/)).toBeVisible();
    expect(within(panel).getByText("File").parentElement).toHaveTextContent("src/main.ets");
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

    expect(await screen.findByRole("tab", { name: "Git Trace" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Git Trace Panel")).toHaveTextContent("Mark ArkTS entry component");
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
    await user.click(screen.getByRole("tab", { name: "Git Trace" }));

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
    await user.click(screen.getByRole("tab", { name: "Git Trace" }));

    expect(await screen.findByLabelText("Git Trace Panel")).toHaveTextContent("Git is unavailable on this machine");
  });

  it("asks to save the current file before loading Git Trace", async () => {
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
    const workspaceApi = createWorkspaceApi({ getFileBlame });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{End}\n// dirty");
    await user.click(screen.getByRole("tab", { name: "Git Trace" }));

    expect(await screen.findByLabelText("Git Trace Panel")).toHaveTextContent("Save the current file to inspect Git Trace.");
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
    await user.click(screen.getAllByRole("button", { name: "Browse..." })[0]);
    await user.click(screen.getByRole("tab", { name: "Validation" }));
    const lintCommand = screen.getByLabelText("Lint Command");
    await user.clear(lintCommand);
    await user.type(lintCommand, "custom-lint");

    expect(workspaceApi.saveSettings).toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Editor" }));
    expect(screen.getByDisplayValue("16")).toBeVisible();
    expect(screen.getByDisplayValue("0.25")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    expect(screen.getByDisplayValue("E:/HarmonyOS/Sdk")).toBeVisible();
    expect(pickPath).toHaveBeenCalledWith({
      directory: true,
      title: "Select HarmonyOS / ArkTS SDK Path",
    });
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
    expect(screen.getByLabelText("Bottom Tool Window")).not.toBeVisible();

    await user.keyboard("{Alt>}1{/Alt}");
    expect(screen.getByLabelText("Files")).toBeVisible();

    await user.keyboard("{Alt>}9{/Alt}");
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");
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
