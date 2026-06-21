import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { AppShell } from "@/components/layout/AppShell";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { defaultSettings } from "@/features/settings/settings-store";
import { vi } from "vitest";

async function openProject(user: ReturnType<typeof userEvent.setup>, path = "C:/samples/DemoWorkspace") {
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
  await user.clear(await screen.findByLabelText("Project Path"));
  await user.type(screen.getByLabelText("Project Path"), path);
  await user.click(screen.getByRole("button", { name: "Open Project" }));
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

  it("opens a native-project fallback dialog from File -> Open Project", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

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

  it("toggles the search pane from the toolbar", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toolRail = screen.getByLabelText("Primary Tool Window Rail");

    await user.click(within(toolRail).getByRole("button", { name: "Search" }));
    const searchPane = await screen.findByRole("region", { name: "Search" });
    expect(searchPane).toBeVisible();
    expect(screen.queryByRole("region", { name: "Files" })).not.toBeInTheDocument();

    await user.click(within(toolRail).getByRole("button", { name: "Search" }));
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeInTheDocument();
  });

  it("switches between project and search in the same left pane", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toolRail = screen.getByLabelText("Primary Tool Window Rail");

    expect(screen.getByRole("region", { name: "Files" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeInTheDocument();

    await user.click(within(toolRail).getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("region", { name: "Search" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "Files" })).not.toBeInTheDocument();

    await user.click(within(toolRail).getByRole("button", { name: "Project" }));
    expect(await screen.findByRole("region", { name: "Files" })).toBeVisible();
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

  it("opens a file from search everywhere and closes the overlay", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Search Everywhere" }));

    const query = await screen.findByLabelText("Search Everywhere Query");
    await user.type(query, "app");

    const results = screen.getByRole("list", { name: "Search Everywhere Results" });
    await user.click(within(results).getByRole("button", { name: "C:\\samples\\DemoWorkspace\\AppScope\\app.json5" }));

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
    await user.click(await screen.findByRole("button", { name: /AlphaWorkspace/ }));

    expect(screen.queryByLabelText("Recent Projects Overlay")).not.toBeInTheDocument();
    expect(await screen.findByText("Workspace: AlphaWorkspace")).toBeVisible();
    expect(await screen.findByRole("button", { name: "main.ets" })).toBeVisible();
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
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

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

  it("opens completion from the editor and inserts the selected item", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
        { label: "@Component", detail: "ArkTS decorator", kind: "keyword" },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{End}");
    await user.keyboard("{Control>} {/Control}");

    await waitFor(() => {
      expect(workspaceApi.completeSymbol).toHaveBeenCalledWith({
        path: "C:\\samples\\DemoWorkspace\\src\\main.ets",
        line: 1,
        column: 7,
      });
    });

    const results = await screen.findByRole("list", { name: "Completion Results" });
    await user.click(within(results).getByRole("button", { name: /build\(\)/ }));

    expect(screen.queryByLabelText("Completion Overlay")).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("@Entrybuild()@Componentstruct Index {}");
  });

  it("finds usages from the editor and opens the selected result", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

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
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

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
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

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

  it("formats the active document from the top bar", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

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
    expect(await screen.findByLabelText("Environment Status")).toBeVisible();
    expect(screen.getByText("Bundled ripgrep not configured yet")).toBeVisible();
  });

  it("loads persisted settings and saves updates through the workspace api", async () => {
    const user = userEvent.setup();
    const settings = defaultSettings();
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
        },
      }),
      saveSettings: vi.fn(async () => undefined),
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

    render(<AppShell workspaceApi={workspaceApi} />);
    const header = screen.getByRole("banner", { name: "Application Header" });

    await user.click(screen.getByRole("button", { name: "Settings" }));

    const fontSize = await screen.findByLabelText("Font Size");
    await user.clear(fontSize);
    await user.type(fontSize, "16");
    const lintCommand = screen.getByLabelText("Lint Command");
    await user.clear(lintCommand);
    await user.type(lintCommand, "custom-lint");

    expect(workspaceApi.saveSettings).toHaveBeenCalled();
    expect(screen.getByDisplayValue("16")).toBeVisible();
    expect(workspaceApi.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        editor: expect.objectContaining({ fontSize: 16 }),
        validation: expect.objectContaining({ lintCommand: "custom-lint" }),
      }),
    );
  });

  it("supports the approved ArkTS sample workflow across project, git, and editor-only modes", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

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
    await user.click(await screen.findByRole("button", { name: "ArkDemoWorkspace C:\\samples\\ArkDemoWorkspace" }));

    expect(await screen.findByText("Workspace: ArkDemoWorkspace")).toBeVisible();
  });

  it("shows a project-open error instead of failing silently", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      pickWorkspaceRoot: async () => null,
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
      runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
      stopTerminalCommand: async () => undefined,
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user, "C:/invalid/project");

    expect(await screen.findByText("Workspace path is not a directory")).toBeVisible();
    expect(screen.getByText("Open Project failed: Workspace path is not a directory")).toBeVisible();
  });
});
