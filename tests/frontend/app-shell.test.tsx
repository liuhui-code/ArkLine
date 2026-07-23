import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { AppShell } from "@/components/layout/AppShell";
import type { LanguageCompletionItem, WorkspaceApi, WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";
import type { WorkspaceEditPlan } from "@/features/code-actions/workspace-edit-model";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
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
    listDeviceFaultLogs: async (request) => ({
      deviceId: request.deviceId,
      fetchedAt: "2026-06-25T15:21:48.000Z",
      entries: [],
      command: "",
      stderr: "",
      status: "ready",
      message: "ok",
    }),
    startDeviceLogStream: async (request) => ({ streamId: "stream-1", deviceId: request.deviceId, status: "running" }),
    stopDeviceLogStream: async () => undefined,
  };
}

function searchEnvelope(items: SearchCandidate[]) {
  return {
    items,
    readiness: {
      rootPath: "C:/samples/DemoWorkspace",
      requestedGeneration: 1,
      servedGeneration: 1,
      state: "ready" as const,
      retryable: false,
    },
    explain: ["query:searchEverywhere", `resultCount:${items.length}`, "readiness:Ready"],
  };
}

function fileSymbolEnvelope(items: SearchCandidate[]) {
  return {
    items,
    readiness: {
      rootPath: "C:/samples/DemoWorkspace",
      requestedGeneration: 1,
      servedGeneration: 1,
      state: "ready" as const,
      retryable: false,
    },
    explain: ["query:fileSymbols", `resultCount:${items.length}`, "readiness:Ready"],
    nextCursor: null,
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
    expect(within(header).queryByRole("button", { name: "Format" })).not.toBeInTheDocument();
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
    expect(within(statusBar).getByText("Index: empty")).toBeVisible();
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

  it("supports IDE-style bottom tool tab context menu actions", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Terminal" }),
    });

    const menu = screen.getByRole("menu", { name: "Terminal tool window actions" });
    expect(within(menu).getByRole("menuitem", { name: "Show Terminal" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Hide Tool Window" })).toBeVisible();

    await user.click(within(menu).getByRole("menuitem", { name: "Show Terminal" }));
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "false");

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Terminal" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "Hide Tool Window" }));
    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "true");

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("tab", { name: "Terminal" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "Show Terminal" }));
    expect(screen.getByLabelText("Bottom Tool Window")).toHaveAttribute("data-collapsed", "false");
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

  it("opens index diagnostics from the status bar with current file readiness", async () => {
    const user = userEvent.setup();
    const runningStatus: WorkspaceIndexTaskStatus = {
      taskId: "2:foreground-navigation",
      rootPath: "C:/samples/DemoWorkspace",
      kind: "foreground-navigation",
      status: "running",
      reason: "current-file",
      generation: 2,
      progressCurrent: 0,
      progressTotal: 1,
      startedAt: 100,
      lastHeartbeatAt: 200,
      symbolCount: undefined,
      message: "Indexing current file",
      error: undefined,
    };
    const resumeWorkspaceIndexing = vi.fn(async () => undefined);
    const rebuildWorkspaceIndex = vi.fn(async () => undefined);
    const rebuildWorkspaceSdkIndex = vi.fn(async () => ({
      taskId: "sdk:1",
      rootPath: "C:/samples/DemoWorkspace",
      kind: "sdk",
      status: "ready",
      reason: "rebuild-sdk",
      generation: 3,
      progressCurrent: 1,
      progressTotal: 1,
      startedAt: 200,
      finishedAt: 300,
      lastHeartbeatAt: 300,
      stalled: false,
      symbolCount: 99,
      message: "SDK indexed",
      error: undefined,
    }));
    const workspaceApi = createWorkspaceApi({
      resumeWorkspaceIndexing,
      rebuildWorkspaceIndex,
      rebuildWorkspaceSdkIndex,
      getWorkspaceIndexTaskStatuses: async () => [runningStatus],
      inspectWorkspaceIndex: async () => ({
        rootPath: "C:/samples/DemoWorkspace",
        status: "partial",
        schemaVersions: { catalog: 1, event: 1 },
        schemaVersionActions: [],
        freshnessLayers: [],
        fileCount: 12,
        symbolCount: 34,
        contentLineCount: 128,
        fingerprintCount: 11,
        stubFileCount: 10,
        stubDeclarationCount: 21,
        dependencyEdgeCount: 3,
        unresolvedImportCount: 1,
        parserErrorCount: 0,
        staleGenerationCount: 1,
        sdkSymbolCount: 99,
        discoveryStatus: "running",
        discoveredFileCount: 2048,
        discoveryExcludedCount: 12,
        discoveryHasMore: true,
        dbSizeBytes: 2048,
        queuePressure: {
          rootPath: "C:/samples/DemoWorkspace",
          pendingTaskCount: 2,
          workspacePendingTaskCount: 1,
          highestPriority: "foreground",
          highestPriorityTaskKind: "foreground-navigation",
        },
        activeSdkPath: "C:/OpenHarmony",
        activeSdkVersion: "settings",
        lastError: "Parser exploded",
        lastExplainStatus: "blocked",
        retryBackoffCount: 0,
        latestRetryBackoff: null,
        repairActions: ["configureSdk", "rebuildProjectIndex", "rebuildSdkIndex", "resumeIndexing"],
        parserFailures: [{
          path: "C:/samples/DemoWorkspace/src/Broken.ets",
          message: "Unexpected token",
          line: 3,
          column: 12,
        }],
        unresolvedImports: [{
          fromPath: "C:/samples/DemoWorkspace/src/Index.ets",
          sourceModule: "./MissingProfile",
          line: 5,
          column: 10,
        }],
        recentEvents: [{
          eventId: "query:symbol:Target:1",
          rootPath: "C:/samples/DemoWorkspace",
          scope: "query",
          kind: "symbol",
          phase: "miss",
          severity: "warning",
          message: "File has no index fingerprint",
          taskId: null,
          generation: null,
          payloadJson: "{\"recommendedAction\":\"rebuildIndex\"}",
          createdAt: 1000,
        }],
        timeline: [{
          scope: "task",
          kind: "refresh-workspace",
          phase: "ready",
          title: "refresh-workspace ready",
          severity: "info",
          message: "Indexed 12 files",
          taskId: "1:refresh-workspace",
          generation: 1,
          occurredAt: 1200,
          durationMs: 200,
        }],
      }),
      getWorkspaceIndexFileReadiness: async () => ({
        rootPath: "C:/samples/DemoWorkspace",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        fileName: "main.ets",
        fileIndex: "ready",
        contentIndex: "ready",
        symbolIndex: "missing",
        parserStatus: "ready",
        parserError: null,
        indexedGeneration: 18,
        semanticLayers: [],
        definitionAvailable: false,
        completionAvailable: true,
        usagesAvailable: false,
        searchAvailable: true,
        reason: "main.ets is in the file index but symbol data is not ready yet.",
      }),
    });
    render(<AppShell workspaceApi={workspaceApi} />);

    await openMainEditor(user);
    await user.click(await screen.findByRole("button", { name: /Open Index Diagnostics/i }));

    const dialog = await screen.findByRole("dialog", { name: "Index Diagnostics Center" });
    expect(within(dialog).getByRole("region", { name: "Processes / Queue" })).toBeVisible();
    expect(within(dialog).getByRole("region", { name: "Current File Readiness" })).toBeVisible();
    expect(within(dialog).getByRole("region", { name: "Query Explain" })).toBeVisible();
    expect(within(dialog).getByRole("region", { name: "Health / Storage" })).toBeVisible();
    expect(within(dialog).getByText("main.ets is in the file index but symbol data is not ready yet.")).toBeVisible();
    expect(within(dialog).getAllByText("foreground-navigation").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByText("0/1 (0%)")).toBeVisible();
    expect(within(dialog).getByText("100ms active")).toBeVisible();
    expect(within(dialog).getByText("Indexing current file")).toBeVisible();
    expect(within(dialog).getByText("Pending total")).toBeVisible();
    expect(within(dialog).getByText("Workspace pending")).toBeVisible();
    expect(within(dialog).getByText("File has no index fingerprint")).toBeVisible();
    expect(within(dialog).getByText("refresh-workspace ready")).toBeVisible();
    expect(within(dialog).getByText("200ms")).toBeVisible();
    expect(within(dialog).getByText("2 KB")).toBeVisible();
    expect(within(dialog).getByText("Parser exploded")).toBeVisible();
    expect(within(within(dialog).getByRole("region", { name: "Health / Storage" })).getByText("blocked")).toBeVisible();
    expect(within(dialog).getByText("Unexpected token")).toBeVisible();
    expect(within(dialog).getByText("C:/samples/DemoWorkspace/src/Broken.ets:3:12")).toBeVisible();
    expect(within(dialog).getByText("./MissingProfile")).toBeVisible();
    expect(within(dialog).getByText("C:/samples/DemoWorkspace/src/Index.ets:5:10")).toBeVisible();
    expect(within(dialog).getByText(/partial .* 12 files/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Resume Indexing" }));
    expect(resumeWorkspaceIndexing).toHaveBeenCalledWith("C:\\samples\\DemoWorkspace");
    await user.click(within(dialog).getByRole("button", { name: "Rebuild Project Index" }));
    expect(rebuildWorkspaceIndex).toHaveBeenCalledWith("C:\\samples\\DemoWorkspace");
    await user.click(within(dialog).getByRole("button", { name: "Rebuild SDK Index" }));
    expect(rebuildWorkspaceSdkIndex).toHaveBeenCalledWith("C:\\samples\\DemoWorkspace");
    await user.click(within(dialog).getByRole("button", { name: "Configure SDK" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  it("shows stalled index tasks in the status bar", async () => {
    const user = userEvent.setup();
    const stalledStatus: WorkspaceIndexTaskStatus = {
      taskId: "4:refresh-workspace",
      rootPath: "C:/samples/DemoWorkspace",
      kind: "refresh-workspace",
      status: "running",
      reason: "refresh-workspace",
      generation: 4,
      progressCurrent: 0,
      progressTotal: 1,
      startedAt: 100,
      lastHeartbeatAt: 100,
      stalled: true,
      symbolCount: undefined,
      message: "No heartbeat for 60s",
      error: undefined,
    };
    const workspaceApi = createWorkspaceApi({
      getWorkspaceIndexTaskStatuses: async () => [stalledStatus],
      watchWorkspaceIndexTaskStatuses: async () => () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);
    await openProject(user);

    expect(await screen.findByText("Index: Stalled, 1 task > 60s")).toBeVisible();

    await user.click(await screen.findByRole("button", { name: /Open Index Diagnostics/i }));
    const dialog = await screen.findByRole("dialog", { name: "Index Diagnostics Center" });
    expect(within(dialog).getByText("No heartbeat > 60s")).toBeVisible();
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

  it("schedules visible-file indexing when a project opens", async () => {
    const user = userEvent.setup();
    const scheduleVisibleFilesIndex = vi.fn(async () => undefined);

    render(<AppShell workspaceApi={createWorkspaceApi({ scheduleVisibleFilesIndex })} />);

    await openProject(user, "C:/samples/ArkDemo");

    await waitFor(() => expect(scheduleVisibleFilesIndex).toHaveBeenCalledWith("C:\\samples\\ArkDemo", [
      "C:\\samples\\ArkDemo\\AppScope\\app.json5",
      "C:\\samples\\ArkDemo\\src\\main.ets",
    ]));
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

  it("auto-opens the most recent project and restores its last active file", async () => {
    const settings = {
      ...defaultSettings(),
      recentProjects: ["C:/samples/DemoWorkspace"],
      workspaceSessions: {
        "C:/samples/DemoWorkspace": {
          activeFilePath: "C:/samples/DemoWorkspace/src/main.ets",
        },
      },
    };
    const openWorkspace = vi.fn(createWorkspaceApi().openWorkspace);
    const openFile = vi.fn(createWorkspaceApi().openFile);

    render(<AppShell workspaceApi={createWorkspaceApi({
      loadSettings: async () => settings,
      openWorkspace,
      openFile,
    })} />);

    expect(await screen.findByText("Workspace: DemoWorkspace")).toBeVisible();
    await waitFor(() => expect(openFile).toHaveBeenCalledWith("C:/samples/DemoWorkspace/src/main.ets"));
    expect(await screen.findByLabelText("Editor Content")).toHaveTextContent("struct Index");
    expect(openWorkspace).toHaveBeenCalledWith("C:/samples/DemoWorkspace");
  });

  it("prefers launch workspace over recent project auto-restore", async () => {
    const settings = {
      ...defaultSettings(),
      recentProjects: ["C:/samples/DemoWorkspace"],
      workspaceSessions: {
        "C:/samples/DemoWorkspace": {
          activeFilePath: "C:/samples/DemoWorkspace/src/main.ets",
        },
      },
    };
    const openWorkspace = vi.fn(createWorkspaceApi().openWorkspace);

    render(<AppShell workspaceApi={createWorkspaceApi({
      getLaunchWorkspacePath: async () => "C:/samples/ArkDemo",
      loadSettings: async () => settings,
      openWorkspace,
    })} />);

    expect(await screen.findByText("Workspace: ArkDemo")).toBeVisible();
    expect(openWorkspace).toHaveBeenCalledWith("C:/samples/ArkDemo");
    expect(openWorkspace).not.toHaveBeenCalledWith("C:/samples/DemoWorkspace");
  });

  it("keeps the restored project open when its last active file is unavailable", async () => {
    const settings = {
      ...defaultSettings(),
      recentProjects: ["C:/samples/DemoWorkspace"],
      workspaceSessions: {
        "C:/samples/DemoWorkspace": {
          activeFilePath: "C:/samples/DemoWorkspace/missing.ets",
        },
      },
    };

    render(<AppShell workspaceApi={createWorkspaceApi({
      loadSettings: async () => settings,
      openFile: async (path) => {
        if (path.endsWith("missing.ets")) throw new Error("not found");
        return createWorkspaceApi().openFile(path);
      },
    })} />);

    expect(await screen.findByText("Workspace: DemoWorkspace")).toBeVisible();
    expect(await screen.findByText("Last file unavailable: not found")).toBeVisible();
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
      summary: (plan as WorkspaceEditPlan).operations.map((operation) => operation.kind),
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

  it("opens workspace edit previews from the project tree context menu", async () => {
    const user = userEvent.setup();
    const previewWorkspaceEdit = vi.fn(async ({ plan }) => ({
      plan,
      conflicts: [],
      affectedFiles: [],
      summary: (plan as WorkspaceEditPlan).operations.map((operation) => operation.kind),
    }));
    render(<AppShell workspaceApi={createWorkspaceApi({ previewWorkspaceEdit })} />);

    await openProject(user);
    const filesPane = screen.getByRole("region", { name: "Files" });

    await user.pointer({
      keys: "[MouseRight]",
      target: within(filesPane).getByRole("button", { name: "src" }),
    });
    await user.click(screen.getByRole("menuitem", { name: "New File" }));
    await user.type(await screen.findByLabelText("New File Name"), "Home.ets");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(previewWorkspaceEdit).toHaveBeenLastCalledWith({
      workspaceRoot: expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace/),
      plan: expect.objectContaining({
        title: "Create File Home.ets",
        operations: [
          {
            kind: "createFile",
            path: expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace[/\\]src[/\\]Home\.ets/),
            content: "",
            overwrite: false,
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

  it("supports IDE-style editor tab context menu actions", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByRole("button", { name: "app.json5" }));

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "main.ets", pressed: false }),
    });
    const menu = screen.getByRole("menu", { name: "main.ets tab actions" });
    expect(within(menu).getByRole("menuitem", { name: "Close Others" })).toBeVisible();
    await user.click(within(menu).getByRole("menuitem", { name: "Copy Path" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/main\.ets$/));

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "main.ets", pressed: false }),
    });
    await user.click(screen.getByRole("menuitem", { name: "Close Others" }));

    const editor = screen.getByRole("main", { name: "Editor" });
    expect(within(editor).getByRole("button", { name: "main.ets", pressed: true })).toBeVisible();
    expect(within(editor).queryByRole("button", { name: "app.json5" })).not.toBeInTheDocument();
  });

  it("supports IDE-style editor content context menu actions", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editorContent = await screen.findByLabelText("Editor Content");

    await user.pointer({
      keys: "[MouseRight]",
      target: editorContent,
    });
    const menu = screen.getByRole("menu", { name: "Editor actions" });
    expect(within(menu).getByRole("menuitem", { name: "Go to Definition" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Find Usages" })).toBeVisible();

    await user.click(within(menu).getByRole("menuitem", { name: "Copy File Path" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/main\.ets$/));

    await user.pointer({
      keys: "[MouseRight]",
      target: editorContent,
    });
    await user.click(screen.getByRole("menuitem", { name: "Format Document" }));

    expect(await screen.findByText("Formatted main.ets")).toBeVisible();
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

  it("opens Search Everywhere with class symbol and file index results", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => searchEnvelope([
      {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 7,
        score: 120,
        freshness: "ready" as const,
      },
      {
        id: "symbol:submit",
        source: "symbol" as const,
        kind: "method",
        title: "submitLogin",
        subtitle: "LoginController · C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 8,
        column: 11,
        score: 80,
        freshness: "ready" as const,
      },
      {
        id: "file:login",
        source: "file" as const,
        kind: "file",
        title: "LoginPage.ets",
        subtitle: "C:/samples/DemoWorkspace/src/LoginPage.ets",
        path: "C:/samples/DemoWorkspace/src/LoginPage.ets",
        line: 1,
        column: 1,
        score: 70,
        freshness: "ready" as const,
      },
    ]));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "C:\\samples\\DemoWorkspace",
     "login",
     "all",
     25,
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
    const results = screen.getByRole("list", { name: "Search Everywhere Results" });
    await waitFor(() => expect(within(results).getByText("Classes")).toBeVisible());
    const classResult = within(results).getByRole("button", { name: /class LoginController/ });
    expect(classResult).toBeVisible();
    expect(within(classResult).getByText("Login")).toHaveClass("search-result__highlight");
    expect(within(results).getByText("Symbols")).toBeVisible();
    expect(within(results).getByRole("button", { name: /symbol submitLogin/ })).toBeVisible();
    expect(within(results).getByText("Files")).toBeVisible();
    expect(within(results).getByRole("button", { name: /file LoginPage\.ets/ })).toBeVisible();
    expect(screen.queryByLabelText("Search Everywhere Preview")).not.toBeInTheDocument();

    await user.click(within(results).getByRole("button", { name: /class LoginController/ }));

    expect(await screen.findByLabelText("Editor Content")).toHaveTextContent("struct Index");
  });

  it("supports IDE-style context menu actions on Search Everywhere candidates", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => searchEnvelope([
      {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 7,
        score: 120,
        freshness: "ready" as const,
      },
    ]));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    const results = await screen.findByRole("list", { name: "Search Everywhere Results" });
    const candidate = await within(results).findByRole("button", { name: /class LoginController/ });
    await user.pointer({
      keys: "[MouseRight]",
      target: candidate,
    });

    const menu = screen.getByRole("menu", { name: "Search result actions" });
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toBeVisible();
    await user.click(within(menu).getByRole("menuitem", { name: "Copy Path" }));

    expect(writeText).toHaveBeenCalledWith("C:/samples/DemoWorkspace/src/main.ets");
  });

  it("moves Search Everywhere focus with keyboard and wheel and opens the focused candidate", async () => {
    const user = userEvent.setup();
    const openFile = vi.fn(async (path: string) => path.endsWith("LoginPage.ets")
      ? "struct LoginPage {}"
      : "@Entry\n@Component\nstruct Index {}");
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => searchEnvelope([
      {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 7,
        score: 120,
        freshness: "ready" as const,
      },
      {
        id: "file:login",
        source: "file" as const,
        kind: "file",
        title: "LoginPage.ets",
        subtitle: "C:/samples/DemoWorkspace/src/LoginPage.ets",
        path: "C:/samples/DemoWorkspace/src/LoginPage.ets",
        line: 1,
        column: 1,
        score: 70,
        freshness: "ready" as const,
      },
    ]));

    render(<AppShell workspaceApi={createWorkspaceApi({ openFile, queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    const results = await screen.findByRole("list", { name: "Search Everywhere Results" });
    await waitFor(() => {
      expect(within(results).getByRole("button", { name: /class LoginController/ })).toBeVisible();
      expect(within(results).getByRole("button", { name: /file LoginPage\.ets/ })).toBeVisible();
    });

    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(within(results).getByRole("button", { name: /file LoginPage\.ets/ })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.wheel(results, { deltaY: -120 });
    await waitFor(() => {
      expect(within(results).getByRole("button", { name: /class LoginController/ })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.wheel(results, { deltaY: 120 });
    await waitFor(() => {
      expect(within(results).getByRole("button", { name: /file LoginPage\.ets/ })).toHaveAttribute("aria-selected", "true");
    });

    await user.keyboard("{Enter}");
    expect(screen.queryByLabelText("Search Everywhere Overlay")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(openFile).toHaveBeenCalledWith("C:/samples/DemoWorkspace/src/LoginPage.ets");
    });
  });

  it("jumps to the clicked Search Everywhere candidate location", async () => {
    const user = userEvent.setup();
    const openFile = vi.fn(async () => "line one\nline two\nstruct LoginController {}");
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => searchEnvelope([
      {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 8,
        score: 120,
        freshness: "ready" as const,
      },
    ]));

    render(<AppShell workspaceApi={createWorkspaceApi({ openFile, queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    const results = await screen.findByRole("list", { name: "Search Everywhere Results" });
    fireEvent.click(await within(results).findByRole("button", { name: /class LoginController/ }));

    const editor = await screen.findByLabelText("Editor Content");
    await waitFor(() => expect(editor).toHaveFocus());
    await user.keyboard("X");

    expect(editor).toHaveTextContent("line oneline twostruct XLoginController {}");
  });

  it("opens the hovered Search Everywhere candidate on primary mouse down", async () => {
    const user = userEvent.setup();
    const openFile = vi.fn(async () => "line one\nline two\nstruct LoginController {}");
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => searchEnvelope([
      {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 8,
        score: 120,
        freshness: "ready" as const,
      },
    ]));

    render(<AppShell workspaceApi={createWorkspaceApi({ openFile, queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    const results = await screen.findByRole("list", { name: "Search Everywhere Results" });
    const result = await within(results).findByRole("button", { name: /class LoginController/ });
    fireEvent.mouseEnter(result);
    fireEvent.mouseDown(result, { button: 0 });

    await waitFor(() => expect(openFile).toHaveBeenCalledWith("C:/samples/DemoWorkspace/src/main.ets"));
    expect(screen.queryByLabelText("Search Everywhere Overlay")).not.toBeInTheDocument();
  });

  it("prefills Double Shift Search Everywhere from the current editor selection", async () => {
    const user = userEvent.setup();
    const openFile = vi.fn(async () => "line one\nline two\nstruct LoginController {}");
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => searchEnvelope([
      {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 8,
        score: 120,
        freshness: "ready" as const,
      },
    ]));

    render(<AppShell workspaceApi={createWorkspaceApi({ openFile, queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    const view = EditorView.findFromDOM(editor);
    expect(view).toBeTruthy();
    if (!view) {
      throw new Error("Editor view was not mounted");
    }
    const from = view.state.doc.toString().indexOf("LoginController");
    act(() => {
      view.dispatch({ selection: { anchor: from, head: from + "LoginController".length } });
    });

    await user.keyboard("{Shift}{Shift}");

    expect(await screen.findByLabelText("Search Everywhere Query")).toHaveValue("LoginController");
    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      expect.stringMatching(/DemoWorkspace$/),
     "LoginController",
     "all",
     expect.any(Number),
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
  });

  it("opens the visually selected Search Everywhere candidate with Enter after grouping", async () => {
    const user = userEvent.setup();
    const openFile = vi.fn(async (path: string) => path.endsWith("LoginPage.ets")
      ? "struct LoginPage {}"
      : "line one\nline two\nstruct LoginController {}");
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => searchEnvelope([
      {
        id: "file:login",
        source: "file" as const,
        kind: "file",
        title: "LoginPage.ets",
        subtitle: "C:/samples/DemoWorkspace/src/LoginPage.ets",
        path: "C:/samples/DemoWorkspace/src/LoginPage.ets",
        line: 1,
        column: 1,
        score: 70,
        freshness: "ready" as const,
      },
      {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 8,
        score: 120,
        freshness: "ready" as const,
      },
    ]));

    render(<AppShell workspaceApi={createWorkspaceApi({ openFile, queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    const results = await screen.findByRole("list", { name: "Search Everywhere Results" });
    const classResult = await within(results).findByRole("button", { name: /class LoginController/ });
    expect(classResult).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(openFile).toHaveBeenCalledWith("C:/samples/DemoWorkspace/src/main.ets"));
  });

  it("shows index explain text when Search Everywhere has no matches", async () => {
    const user = userEvent.setup();
    const explainWorkspaceIndexQuery = vi.fn(async () => ({
      status: "notIndexed" as const,
      message: "No indexed evidence explains this query yet",
      facts: [{ category: "query", evidence: "missingThing" }],
      recommendedAction: "rebuildIndex" as const,
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ explainWorkspaceIndexQuery })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "missingThing");

    await waitFor(() => expect(explainWorkspaceIndexQuery).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: "C:\\samples\\DemoWorkspace",
      kind: "search",
      query: "missingThing",
    })));
    expect(await screen.findByText("Search Everywhere miss: No indexed evidence explains this query yet. Rebuild Index.")).toBeVisible();
  });

  it("uses Search Everywhere envelope explain before running a separate explain query", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [],
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 7,
        servedGeneration: 6,
        state: "partial" as const,
        reason: "Current query is waiting for the symbol index",
        retryable: true,
      },
      explain: [
        "query:searchEverywhere",
        "resultCount:0",
        "readiness:Partial",
        "reason:Current query is waiting for the symbol index",
      ],
    }));
    const explainWorkspaceIndexQuery = vi.fn(async () => ({
      status: "notIndexed" as const,
      message: "No indexed evidence explains this query yet",
      facts: [{ category: "query", evidence: "missingThing" }],
      recommendedAction: "rebuildIndex" as const,
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness, explainWorkspaceIndexQuery })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "missingThing");

    expect(await screen.findByText("Search Everywhere miss: Current query is waiting for the symbol index")).toBeVisible();
    expect(explainWorkspaceIndexQuery).not.toHaveBeenCalled();
  });

  it("does not query Search Everywhere until the user enters text", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [],
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    expect(await screen.findByLabelText("Search Everywhere Query")).toHaveFocus();
    await new Promise((resolve) => window.setTimeout(resolve, 20));

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Search Everywhere Query"), "login");
    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith(
      "C:\\samples\\DemoWorkspace",
     "login",
     "all",
     25,
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
  });

  it("shows truncation metadata when Search Everywhere has more results than the display cap", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: Array.from({ length: 25 }, (_value, index) => ({
        id: `file:Result${index}`,
        source: "file" as const,
        kind: "file",
        title: `Result${index}.ets`,
        subtitle: `C:/samples/DemoWorkspace/src/Result${index}.ets`,
        path: `C:/samples/DemoWorkspace/src/Result${index}.ets`,
        line: 1,
        column: 1,
        score: 100 - index,
        freshness: "ready" as const,
      })),
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "result");

    expect(await screen.findByText("Showing 24 of at least 25 all result(s). Refine the query to see more.")).toBeVisible();
    expect(screen.getByRole("button", { name: /file Result23\.ets/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /file Result24\.ets/ })).not.toBeInTheDocument();
  });

  it("coalesces rapid Search Everywhere typing into the latest query", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [],
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    const input = await screen.findByLabelText("Search Everywhere Query");

    fireEvent.change(input, { target: { value: "l" } });
    fireEvent.change(input, { target: { value: "lo" } });
    fireEvent.change(input, { target: { value: "login" } });

    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith(
      "C:\\samples\\DemoWorkspace",
     "login",
     "all",
     25,
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);
  });

  it("filters Search Everywhere through scoped index categories", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async (_rootPath: string, _query: string, scope: string) => {
      if (scope === "classes") {
        return searchEnvelope([{
          id: "class:login",
          source: "class" as const,
          kind: "class",
          title: "LoginController",
          subtitle: "C:/samples/DemoWorkspace/src/main.ets",
          path: "C:/samples/DemoWorkspace/src/main.ets",
          line: 3,
          column: 7,
          score: 120,
          freshness: "ready" as const,
        }]);
      }

      return searchEnvelope([
        {
          id: "class:login",
          source: "class" as const,
          kind: "class",
          title: "LoginController",
          subtitle: "C:/samples/DemoWorkspace/src/main.ets",
          path: "C:/samples/DemoWorkspace/src/main.ets",
          line: 3,
          column: 7,
          score: 120,
          freshness: "ready" as const,
        },
        {
          id: "api:login",
          source: "api" as const,
          kind: "method",
          title: "loginAction",
          subtitle: "LoginApi · C:/HarmonyOS/Sdk/login-api.d.ts",
          path: "C:/HarmonyOS/Sdk/login-api.d.ts",
          line: 2,
          column: 3,
          score: 80,
          freshness: "ready" as const,
        },
      ]);
    });

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "C:\\samples\\DemoWorkspace",
     "login",
     "all",
     25,
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
    expect(await screen.findByRole("button", { name: /api loginAction/ })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Classes" }));

    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "C:\\samples\\DemoWorkspace",
     "login",
     "classes",
     25,
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
    expect(screen.getByRole("tab", { name: "Classes", selected: true })).toBeVisible();
    expect(screen.getByRole("button", { name: /class LoginController/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /api loginAction/ })).not.toBeInTheDocument();
  });

  it("uses readiness-aware facade candidates for Search Everywhere when available", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async (_rootPath: string, _query: string, scope: string) => ({
      items: scope === "classes"
        ? [{
          id: "class:login",
          source: "class" as const,
          kind: "class",
          title: "LoginController",
          subtitle: "C:/samples/DemoWorkspace/src/main.ets",
          path: "C:/samples/DemoWorkspace/src/main.ets",
          line: 3,
          column: 7,
          score: 120,
          freshness: "ready" as const,
        }]
        : [
          {
            id: "class:login",
            source: "class" as const,
            kind: "class",
            title: "LoginController",
            subtitle: "C:/samples/DemoWorkspace/src/main.ets",
            path: "C:/samples/DemoWorkspace/src/main.ets",
            line: 3,
            column: 7,
            score: 120,
            freshness: "ready" as const,
          },
          {
            id: "text:login",
            source: "text" as const,
            kind: "text",
            title: "Text(\"Login\")",
            subtitle: "src/main.ets:4",
            path: "C:/samples/DemoWorkspace/src/main.ets",
            line: 4,
            column: 12,
            score: 40,
            freshness: "ready" as const,
          },
        ],
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "C:\\samples\\DemoWorkspace",
     "login",
     "all",
     25,
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
    expect(await screen.findByRole("button", { name: /class LoginController/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /text Text\("Login"\)/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Classes" }));
    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "C:\\samples\\DemoWorkspace",
     "login",
     "classes",
     25,
     null,
     expect.any(Object),
      expect.any(Number),
      250,
   ));
    expect(screen.getByRole("button", { name: /class LoginController/ })).toBeVisible();
  });

  it("keeps Search Everywhere All focused on navigable entities instead of text matches", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [
        {
          id: "text:login",
          source: "text" as const,
          kind: "text",
          title: "Text(\"Login\")",
          subtitle: "src/main.ets:4",
          path: "C:/samples/DemoWorkspace/src/main.ets",
          line: 4,
          column: 12,
          score: 40,
          freshness: "ready" as const,
        },
        {
          id: "class:login",
          source: "class" as const,
          kind: "class",
          title: "LoginController",
          subtitle: "C:/samples/DemoWorkspace/src/main.ets",
          path: "C:/samples/DemoWorkspace/src/main.ets",
          line: 3,
          column: 7,
          score: 120,
          freshness: "ready" as const,
        },
      ],
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness })} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");

    expect(await screen.findByRole("button", { name: /class LoginController/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /text Text\("Login"\)/ })).not.toBeInTheDocument();
  });

  it("filters Search Everywhere categories through the readiness query api", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async (_rootPath: string, _query: string, scope: string) => {
      const classCandidate = {
        id: "class:login",
        source: "class" as const,
        kind: "class",
        title: "LoginController",
        subtitle: "C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 3,
        column: 7,
        score: 120,
        freshness: "ready" as const,
      };
      const apiCandidate = {
        id: "api:login",
        source: "api" as const,
        kind: "method",
        title: "loginAction",
        subtitle: "LoginApi · C:/HarmonyOS/Sdk/login-api.d.ts",
        path: "C:/HarmonyOS/Sdk/login-api.d.ts",
        line: 2,
        column: 3,
        score: 80,
        freshness: "ready" as const,
      };
      return searchEnvelope(scope === "classes" ? [classCandidate] : [classCandidate, apiCandidate]);
    });
    const workspaceApi = createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");
    await user.type(await screen.findByLabelText("Search Everywhere Query"), "login");
    expect(await screen.findByRole("button", { name: /api loginAction/ })).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Classes" }));

    expect(screen.getByRole("button", { name: /class LoginController/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /api loginAction/ })).not.toBeInTheDocument();
  });

  it("refreshes the workspace index from external filesystem changes", async () => {
    const user = userEvent.setup();
    const rootPath = "C:/samples/DemoWorkspace";
    let pollWorkspace: (() => void) | null = null;
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler) => {
      if (typeof handler === "function") {
        pollWorkspace = handler as () => void;
      }
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });
    const clearIntervalSpy = vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    const refreshWorkspaceIndexWithChanges = vi.fn(async () => ({
      state: {
        status: "ready" as const,
        rootPath: "C:\\samples\\DemoWorkspace",
        filePaths: [
          "C:\\samples\\DemoWorkspace\\AppScope\\app.json5",
          "C:\\samples\\DemoWorkspace\\src\\About.ets",
        ],
        indexedAt: Date.now(),
        partialReason: null,
      },
      changed: true,
      addedPaths: ["C:\\samples\\DemoWorkspace\\src\\About.ets"],
      removedPaths: ["C:\\samples\\DemoWorkspace\\src\\main.ets"],
    }));

    try {
      render(
        <AppShell
          workspaceApi={createWorkspaceApi({
            refreshWorkspaceIndexWithChanges,
          })}
        />,
      );

      await openProject(user, rootPath);

      expect(pollWorkspace).not.toBeNull();
      await act(async () => {
        pollWorkspace?.();
        await Promise.resolve();
      });

      expect(refreshWorkspaceIndexWithChanges).toHaveBeenCalledWith("C:\\samples\\DemoWorkspace");

      await user.keyboard("{Control>}p{/Control}");
      const query = await screen.findByLabelText("Quick Open Query");
      await user.type(query, "about");

      const results = screen.getByRole("list", { name: "Quick Open Results" });
      expect(within(results).getByRole("button", { name: "C:\\samples\\DemoWorkspace\\src\\About.ets" })).toBeVisible();
      expect(within(results).queryByRole("button", { name: "C:\\samples\\DemoWorkspace\\src\\main.ets" })).not.toBeInTheDocument();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });

  it("uses workspace index watcher events instead of polling when available", async () => {
    const user = userEvent.setup();
    const rootPath = "C:/samples/DemoWorkspace";
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    let emitIndexRefresh: ((result: Awaited<ReturnType<NonNullable<WorkspaceApi["refreshWorkspaceIndexWithChanges"]>>>) => void) | null = null;
    const watchWorkspaceIndex = vi.fn(async (_rootPath: string, onChange: (result: Awaited<ReturnType<NonNullable<WorkspaceApi["refreshWorkspaceIndexWithChanges"]>>>) => void) => {
      emitIndexRefresh = onChange;
      return () => {
        emitIndexRefresh = null;
      };
    });
    const refreshWorkspaceIndexWithChanges = vi.fn(async () => ({
      state: {
        status: "ready" as const,
        rootPath,
        filePaths: ["C:/samples/DemoWorkspace/src/main.ets"],
        indexedAt: Date.now(),
        partialReason: null,
      },
      changed: false,
      addedPaths: [],
      removedPaths: [],
    }));

    try {
      render(
        <AppShell
          workspaceApi={createWorkspaceApi({
            refreshWorkspaceIndexWithChanges,
            watchWorkspaceIndex,
          })}
        />,
      );

      await openProject(user, rootPath);

      await waitFor(() => expect(watchWorkspaceIndex).toHaveBeenCalledWith("C:\\samples\\DemoWorkspace", expect.any(Function)));
      expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 5_000);

      await act(async () => {
        emitIndexRefresh?.({
          state: {
            status: "ready",
            rootPath: "C:\\samples\\DemoWorkspace",
            filePaths: ["C:\\samples\\DemoWorkspace\\AppScope\\About.ets"],
            indexedAt: Date.now(),
            partialReason: null,
          },
          changed: true,
          addedPaths: ["C:\\samples\\DemoWorkspace\\AppScope\\About.ets"],
          removedPaths: ["C:\\samples\\DemoWorkspace\\src\\main.ets"],
        });
      });

      await user.keyboard("{Control>}p{/Control}");
      const query = await screen.findByLabelText("Quick Open Query");
      await user.type(query, "about");

      const results = screen.getByRole("list", { name: "Quick Open Results" });
      expect(within(results).getByRole("button", { name: "C:\\samples\\DemoWorkspace\\AppScope\\About.ets" })).toBeVisible();
      expect(within(results).queryByRole("button", { name: "C:\\samples\\DemoWorkspace\\src\\main.ets" })).not.toBeInTheDocument();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it("marks truncated workspace scans as partial in status, quick open, and find in files", async () => {
    const user = userEvent.setup();
    const rootPath = "C:/samples/LargeWorkspace";
    const files = Array.from({ length: 20_000 }, (_, index) => `${rootPath}/src/file-${index}.ets`);

    render(
      <AppShell
        workspaceApi={createWorkspaceApi({
          openWorkspace: async () => ({
            rootName: "LargeWorkspace",
            rootPath,
            files,
            scanSummary: {
              scannedFiles: 20_000,
              skippedEntries: 12,
              truncated: true,
              excludeRules: [".git", "node_modules", "oh_modules"],
            },
          }),
        })}
      />,
    );

    await openProject(user, rootPath);

    expect(await screen.findByText("Workspace: partial (20,000 files)")).toBeVisible();
    expect(await screen.findByText("Index: partial (20,000 files)")).toBeVisible();

    await user.keyboard("{Control>}p{/Control}");
    expect(await screen.findByText(/Partial workspace results: scan stopped at 20,000 files/)).toBeVisible();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find in Files" }));

    expect(await screen.findByText(/Partial workspace results: scan stopped at 20,000 files/)).toBeVisible();
  });

  it("loads the root project tree when a partial workspace snapshot has no visible files", async () => {
    const user = userEvent.setup();
    const rootPath = "C:/samples/HugeWorkspace";
    const listWorkspaceDirectory = vi.fn(async () => [
      {
        name: "entry",
        path: `${rootPath}/entry`,
        kind: "directory" as const,
        excluded: false,
        hasChildren: true,
      },
    ]);

    render(
      <AppShell
        workspaceApi={createWorkspaceApi({
          listWorkspaceDirectory,
          openWorkspace: async () => ({
            rootName: "HugeWorkspace",
            rootPath,
            files: [],
            scanSummary: {
              scannedFiles: 0,
              skippedEntries: 0,
              truncated: true,
              excludeRules: [".git", "node_modules", "oh_modules"],
            },
          }),
        })}
      />,
    );

    await openProject(user, rootPath);

    await waitFor(() => {
      expect(listWorkspaceDirectory).toHaveBeenCalledWith(
        "C:\\samples\\HugeWorkspace",
        "C:\\samples\\HugeWorkspace",
      );
    });
    expect(await screen.findByRole("button", { name: "entry" })).toBeVisible();
  });

  it("opens a persistent Quick Open result from a lazy workspace with Enter", async () => {
    const user = userEvent.setup();
    const rootPath = "C:/samples/HugeWorkspace";
    const filePath = "C:\\samples\\HugeWorkspace\\entry\\src\\Page000000.ets";
    const openFile = vi.fn(async () => "export class Page000000 {}");
    const queryWorkspaceQuickOpen = vi.fn(async () => [{
      id: `file:${filePath}`,
      source: "file" as const,
      kind: "file",
      title: "Page000000.ets",
      subtitle: filePath,
      path: filePath,
      line: 1,
      column: 1,
      score: 100,
    }]);

    render(
      <AppShell
        workspaceApi={createWorkspaceApi({
          openFile,
          queryWorkspaceQuickOpen,
          listWorkspaceDirectory: async () => [],
          openWorkspace: async () => ({
            rootName: "HugeWorkspace",
            rootPath,
            files: [],
            scanSummary: {
              scannedFiles: 0,
              skippedEntries: 0,
              truncated: true,
              excludeRules: [".git", "node_modules", "oh_modules"],
            },
          }),
        })}
      />,
    );

    await openProject(user, rootPath);
    await user.keyboard("{Control>}p{/Control}");
    await user.type(await screen.findByLabelText("Quick Open Query"), "Page000000");
    expect(await screen.findByRole("button", { name: filePath })).toBeVisible();

    await user.keyboard("{Enter}");

    expect(openFile).toHaveBeenCalledWith(filePath);
    expect(await screen.findByRole("button", { name: "Page000000.ets" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("adds an opened lazy project file to the workspace index immediately", async () => {
    const user = userEvent.setup();
    const rootPath = "C:/samples/HugeWorkspace";
    const filePath = `${rootPath}/entry/src/main/ets/EntryBackupAbility.ets`;
    const updateWorkspaceIndexFiles = vi.fn(async () => ({
      status: "partial" as const,
      rootPath: "C:\\samples\\HugeWorkspace",
      filePaths: ["C:\\samples\\HugeWorkspace\\entry\\src\\main\\ets\\EntryBackupAbility.ets"],
      symbols: [],
      indexedAt: 1,
      partialReason: "Visible file indexed",
    }));
    const listWorkspaceDirectory = vi.fn(async (_root: string, directoryPath: string) => {
      const normalizedDirectory = directoryPath.replace(/\\/g, "/");
      if (normalizedDirectory.endsWith("HugeWorkspace")) {
        return [{ name: "entry", path: `${rootPath}/entry`, kind: "directory" as const, excluded: false, hasChildren: true }];
      }
      if (normalizedDirectory.endsWith("entry")) {
        return [{ name: "src", path: `${rootPath}/entry/src`, kind: "directory" as const, excluded: false, hasChildren: true }];
      }
      if (normalizedDirectory.endsWith("src")) {
        return [{ name: "main", path: `${rootPath}/entry/src/main`, kind: "directory" as const, excluded: false, hasChildren: true }];
      }
      if (normalizedDirectory.endsWith("main")) {
        return [{ name: "ets", path: `${rootPath}/entry/src/main/ets`, kind: "directory" as const, excluded: false, hasChildren: true }];
      }
      return [{ name: "EntryBackupAbility.ets", path: filePath, kind: "file" as const, excluded: false, hasChildren: false }];
    });

    render(
      <AppShell
        workspaceApi={createWorkspaceApi({
          listWorkspaceDirectory,
          updateWorkspaceIndexFiles,
          openWorkspace: async () => ({
            rootName: "HugeWorkspace",
            rootPath,
            files: [],
            scanSummary: {
              scannedFiles: 0,
              skippedEntries: 0,
              truncated: true,
              excludeRules: [".git", "node_modules", "oh_modules"],
            },
          }),
        })}
      />,
    );

    await openProject(user, rootPath);
    await user.click(await screen.findByRole("button", { name: "entry" }));
    await user.click(await screen.findByRole("button", { name: "src" }));
    await user.click(await screen.findByRole("button", { name: "main" }));
    await user.click(await screen.findByRole("button", { name: "ets" }));
    await user.click(await screen.findByRole("button", { name: "EntryBackupAbility.ets" }));

    await waitFor(() => expect(updateWorkspaceIndexFiles).toHaveBeenCalledWith(
      "C:\\samples\\HugeWorkspace",
      ["C:\\samples\\HugeWorkspace\\entry\\src\\main\\ets\\EntryBackupAbility.ets"],
      [],
    ));
    expect(await screen.findByText("Index: partial (1 files)")).toBeVisible();
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
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Find in Files Results" })).getAllByText("main.ets")[0]).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Aa" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Find in Files Results" })).getByText("No matches")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Aa" }));
    await user.clear(query);
    await user.type(query, "/bundleName/");

    const results = screen.getByRole("list", { name: "Find in Files Results" });
    await waitFor(() => expect(within(results).getAllByText("app.json5")[0]).toBeVisible());
    expect(within(results).getByText("AppScope/app.json5")).toBeVisible();
    expect(within(results).getByText("1 match")).toBeVisible();
    const appJsonMatch = within(results).getByRole("button", { name: /AppScope\/app\.json5:3:6/ });
    expect(within(appJsonMatch).getByText("3")).toHaveClass("search-result__line-number");
    expect(within(appJsonMatch).getByText("bundleName")).toHaveClass("search-result__highlight");
    expect(within(appJsonMatch).getByText(/"app": \{/)).toHaveClass("search-result__context-text");

    const preview = screen.getByLabelText("Search Everywhere Preview");
    expect(within(preview).getByText("AppScope/app.json5:3:6")).toBeVisible();
    expect(within(preview).getByText("bundleName")).toBeVisible();
    await waitFor(() => {
      expect(within(preview).getByText(/"app": \{/)).toBeVisible();
    });

    fireEvent.click(within(results).getByRole("button", { name: /app\.json5/i }));

    expect(screen.queryByLabelText("Search Everywhere Overlay")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "app.json5", pressed: true })).toBeVisible();
    const editor = await screen.findByLabelText("Editor Content");
    expect(editor).toHaveTextContent("\"bundleName\": \"com.demo.app\"");
    await waitFor(() => expect(editor).toHaveFocus());
  });

  it("moves Find in Files focus with keyboard and wheel and opens the focused match", async () => {
    const user = userEvent.setup();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const rootPath = "C:/samples/DemoWorkspace";
    const firstPath = `${rootPath}/src/First.ets`;
    const secondPath = `${rootPath}/src/Second.ets`;
    const openFile = vi.fn(async (path: string) => path.endsWith("Second.ets")
      ? "struct Second {\n  needleTwo() {}\n}"
      : "struct First {\n  needleOne() {}\n}");

    try {
      render(
        <AppShell
          workspaceApi={createWorkspaceApi({
            openFile,
            openWorkspace: async () => ({
              rootName: "DemoWorkspace",
              rootPath,
              files: [firstPath, secondPath],
            }),
          })}
        />,
      );

      await openProject(user, rootPath);
      await user.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
      await user.type(await screen.findByLabelText("Find in Files Query"), "needle");

      const results = await screen.findByRole("list", { name: "Find in Files Results" });
      await waitFor(() => {
        expect(within(results).getByRole("button", { name: /First\.ets.*needleOne/ })).toBeVisible();
        expect(within(results).getByRole("button", { name: /Second\.ets.*needleTwo/ })).toBeVisible();
      });
      const firstMatch = within(results).getByRole("button", { name: /First\.ets.*needleOne/ });
      expect(within(firstMatch).getByText("needle")).toHaveClass("search-result__highlight");
      expect(within(firstMatch).getByText("struct First {")).toHaveClass("search-result__context-text");

      const scrollCallsBeforeMove = scrollIntoView.mock.calls.length;
      await user.keyboard("{ArrowDown}");
      expect(within(results).getByRole("button", { name: /Second\.ets.*needleTwo/ })).toHaveAttribute("aria-selected", "true");
      expect(scrollIntoView.mock.calls.length).toBeGreaterThan(scrollCallsBeforeMove);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });

      fireEvent.wheel(results, { deltaY: -120 });
      expect(within(results).getByRole("button", { name: /First\.ets.*needleOne/ })).toHaveAttribute("aria-selected", "true");

      fireEvent.wheel(results, { deltaY: 120 });
      expect(within(results).getByRole("button", { name: /Second\.ets.*needleTwo/ })).toHaveAttribute("aria-selected", "true");

      const secondMatch = within(results).getByRole("button", { name: /Second\.ets.*needleTwo/ });
      expect(within(secondMatch).getByText("2")).toHaveClass("search-result__line-number");
      expect(within(secondMatch).getByText("needle")).toHaveClass("search-result__highlight");
      expect(within(secondMatch).getByText("struct Second {")).toHaveClass("search-result__context-text");

      await user.keyboard("{Enter}");
      expect(screen.queryByLabelText("Find in Files Overlay")).not.toBeInTheDocument();
      expect(await screen.findByRole("button", { name: "Second.ets", pressed: true })).toBeVisible();
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("supports IDE-style context menu actions on Find in Files results", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<App />);

    await openProject(user);
    await user.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
    await user.type(await screen.findByLabelText("Find in Files Query"), "Index");

    const results = await screen.findByRole("list", { name: "Find in Files Results" });
    const match = await within(results).findByRole("button", { name: /src[/\\]main\.ets:3:8/ });
    await user.pointer({
      keys: "[MouseRight]",
      target: match,
    });

    const menu = screen.getByRole("menu", { name: "Search result actions" });
    expect(within(menu).getByRole("menuitem", { name: "Open" })).toBeVisible();
    await user.click(within(menu).getByRole("menuitem", { name: "Copy Path" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/main\.ets$/));
  });

  it("uses readiness-aware text facade for plain Find in Files when available", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [{
        id: "text:app-json:3:6",
        source: "text" as const,
        kind: "text",
        title: "\"bundleName\": \"com.demo.app\"",
        subtitle: "AppScope/app.json5:3",
        path: "C:/samples/DemoWorkspace/AppScope/app.json5",
        line: 3,
        column: 6,
        score: 40,
        freshness: "ready" as const,
        signature: "    \"bundleName\": \"com.demo.app\"",
      }],
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
    }));
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "bundle" },
      matches: [],
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness, searchWorkspaceText })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find in Files" }));
    await user.type(await screen.findByLabelText("Find in Files Query"), "bundle");

    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "C:\\samples\\DemoWorkspace",
      "bundle",
      "text",
      50,
      null,
      undefined,
      expect.any(Number),
      1_500,
    ));
    expect(searchWorkspaceText).not.toHaveBeenCalled();
    expect(within(screen.getByRole("list", { name: "Find in Files Results" })).getByRole("button", {
      name: /AppScope\/app\.json5:3:6/,
    })).toBeVisible();
  });

  it("shows partial readiness from indexed Find in Files instead of treating empty results as complete", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [],
      readiness: {
        rootPath: "C:\\samples\\DemoWorkspace",
        requestedGeneration: 7,
        servedGeneration: 6,
        state: "partial" as const,
        reason: "Index is still scanning generated files",
        retryable: true,
      },
    }));
    const explainWorkspaceIndexQuery = vi.fn(async () => ({
      status: "notIndexed" as const,
      message: "No indexed evidence explains this query yet",
      facts: [{ category: "query", evidence: "missingText" }],
      recommendedAction: "rebuildIndex" as const,
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ queryWorkspaceCandidatesWithReadiness, explainWorkspaceIndexQuery })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find in Files" }));
    await user.type(await screen.findByLabelText("Find in Files Query"), "missingText");

    expect(await screen.findByText("Index is still scanning generated files")).toBeVisible();
    expect(explainWorkspaceIndexQuery).not.toHaveBeenCalled();
  });

  it("shows index explain text when Find in Files has no matches", async () => {
    const user = userEvent.setup();
    const explainWorkspaceIndexQuery = vi.fn(async () => ({
      status: "notIndexed" as const,
      message: "No indexed evidence explains this query yet",
      facts: [{ category: "query", evidence: "missingText" }],
      recommendedAction: "rebuildIndex" as const,
    }));

    render(<AppShell workspaceApi={createWorkspaceApi({ explainWorkspaceIndexQuery })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find in Files" }));
    await user.type(await screen.findByLabelText("Find in Files Query"), "missingText");

    await waitFor(() => expect(explainWorkspaceIndexQuery).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: "C:\\samples\\DemoWorkspace",
      kind: "search",
      query: "missingText",
    })));
    expect(await screen.findByText("Find in Files miss: No indexed evidence explains this query yet. Rebuild Index.")).toBeVisible();
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

  it("opens Search Everywhere smaller by default and supports panel resizing", async () => {
    const user = userEvent.setup();
    render(<App />);

    await openProject(user);
    await user.keyboard("{Shift}{Shift}");

    const panel = await screen.findByLabelText("Search Everywhere Panel");
    expect(panel).toHaveStyle("--search-everywhere-panel-width: 760px");
    expect(panel).toHaveStyle("--search-everywhere-panel-height: 420px");

    fireEvent.mouseDown(screen.getByRole("button", { name: "Resize Search Everywhere Panel" }), {
      button: 0,
      clientX: 760,
      clientY: 420,
      pageX: 760,
      pageY: 420,
    });
    fireEvent.mouseMove(window, { clientX: 860, clientY: 500 });
    fireEvent.mouseUp(window);

    expect(panel).toHaveStyle("--search-everywhere-panel-width: 860px");
    expect(panel).toHaveStyle("--search-everywhere-panel-height: 500px");
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

  it("opens current-class methods with Ctrl+F12, filters, and jumps to the selected method", async () => {
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
    await user.keyboard("{Control>}{F12}{/Control}");

    expect(await screen.findByRole("dialog", { name: "File Structure" })).toBeVisible();
    expect(screen.getByRole("option", { name: /build\(\).*line 5/ })).toBeVisible();

    await user.type(screen.getByLabelText("File Structure Query"), "tap");
    expect(screen.queryByRole("option", { name: /build\(\)/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /handleTap\(event: ClickEvent\).*line 6/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog", { name: "File Structure" })).not.toBeInTheDocument();
    expect(await screen.findByText("Method: handleTap(event: ClickEvent)")).toBeVisible();
  });

  it("uses indexed file symbols for Ctrl+F12 when available", async () => {
    const user = userEvent.setup();
    const queryWorkspaceFileSymbolsWithReadiness = vi.fn(async () => fileSymbolEnvelope([
      {
        id: "symbol:C:/samples/DemoWorkspace/src/main.ets:4:3",
        source: "symbol" as const,
        kind: "method",
        title: "indexedBuild",
        subtitle: "Index · C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 4,
        column: 3,
        score: 0,
        freshness: "ready" as const,
      },
    ]));
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
        "  indexedBuild() {}",
        "}",
      ].join("\n"),
      queryWorkspaceFileSymbolsWithReadiness,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("{Control>}{F12}{/Control}");

    expect(queryWorkspaceFileSymbolsWithReadiness).toHaveBeenCalledWith(
      "C:\\samples\\DemoWorkspace",
      "C:\\samples\\DemoWorkspace\\src\\main.ets",
      "",
      80,
      null,
    );
    expect(await screen.findByRole("option", { name: /indexedBuild\(\).*line 4/ })).toBeVisible();
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

  it("does not jump when definition facade returns multiple stale candidates", async () => {
    const user = userEvent.setup();
    const gotoDefinition = vi.fn(async () => ({
      path: "C:/samples/DemoWorkspace/src/legacy.ets",
      line: 1,
      column: 1,
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
      queryDefinitionCandidatesWithReadiness: vi.fn(async () => ({
        items: [
          { path: "C:/samples/DemoWorkspace/src/A.ets", line: 1, column: 1, preview: "class A" },
          { path: "C:/samples/DemoWorkspace/src/B.ets", line: 1, column: 1, preview: "class B" },
        ],
        readiness: {
          rootPath: "C:/samples/DemoWorkspace",
          requestedGeneration: 3,
          servedGeneration: 2,
          state: "stale" as const,
          reason: "Index is stale",
          retryable: true,
        },
      })),
      gotoDefinition,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}b{/Control}");

    expect(await screen.findByText("Go to Definition has 2 stale candidates; wait for the index to refresh.")).toBeVisible();
    expect(gotoDefinition).not.toHaveBeenCalled();
  });

  it("shows index explain text when definition lookup misses", async () => {
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
      openFile: async () => "const value = missingTarget;\n",
      saveFile: async () => undefined,
      runValidation: async () => [],
      loadDiff: async () => "",
      inspectEnvironment: async () => ({ tools: [] }),
      gotoDefinition: vi.fn(async () => null),
      gotoDefinitionCandidates: vi.fn(async () => []),
      explainWorkspaceIndexQuery: vi.fn(async () => ({
        status: "sdkNotReady" as const,
        message: "SDK API index is not ready for this workspace",
        facts: [{ category: "query", evidence: "missingTarget" }],
        recommendedAction: "configureSdk" as const,
      })),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}b{/Control}");

    await waitFor(() => expect(workspaceApi.explainWorkspaceIndexQuery).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: "C:\\samples\\DemoWorkspace",
      kind: "definition",
    })));
    const explainButton = await screen.findByRole("button", { name: /Go to Definition miss: SDK API index is not ready for this workspace\. Configure SDK\./ });
    expect(explainButton).toBeVisible();
    await user.click(explainButton);
    expect(await screen.findByRole("region", { name: "Index Explain Panel" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "query" })).toBeVisible();
    expect(screen.getByRole("cell", { name: "missingTarget" })).toBeVisible();
  });

  it("uses definition envelope explain before running a separate explain query", async () => {
    const user = userEvent.setup();
    const explainWorkspaceIndexQuery = vi.fn(async () => ({
      status: "notIndexed" as const,
      message: "Separate explain query should not be needed",
      facts: [],
      recommendedAction: "rebuildIndex" as const,
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
      openFile: async () => "const value = missingTarget;\n",
      queryDefinitionCandidatesWithReadiness: vi.fn(async () => ({
        items: [],
        readiness: {
          rootPath: "C:/samples/DemoWorkspace",
          requestedGeneration: 7,
          servedGeneration: 6,
          state: "partial" as const,
          reason: "Definition waits for current file symbol index",
          retryable: true,
        },
        explain: [
          "query:definition",
          "usedIndexes:WorkspaceIndex",
          "resultCount:0",
          "readiness:Partial",
          "reason:Definition waits for current file symbol index",
        ],
      })),
      gotoDefinition: vi.fn(async () => null),
      gotoDefinitionCandidates: vi.fn(async () => []),
      explainWorkspaceIndexQuery,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("{Control>}b{/Control}");

    expect(await screen.findByRole("button", { name: /Go to Definition miss: Definition waits for current file symbol index/ })).toBeVisible();
    expect(explainWorkspaceIndexQuery).not.toHaveBeenCalled();
  });

  it("rebuilds the index from the explain panel", async () => {
    const user = userEvent.setup();
    const rebuildWorkspaceIndex = vi.fn(async () => undefined);
    const refreshWorkspaceIndex = vi.fn(async () => ({
      status: "ready" as const,
      rootPath: "C:\\samples\\DemoWorkspace",
      filePaths: ["C:\\samples\\DemoWorkspace\\src\\main.ets"],
      symbols: [],
      indexedAt: 2,
      partialReason: null,
    }));
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "const value = missingTarget;\n",
      gotoDefinition: vi.fn(async () => null),
      gotoDefinitionCandidates: vi.fn(async () => []),
      explainWorkspaceIndexQuery: vi.fn(async () => ({
        status: "notIndexed" as const,
        message: "File is not indexed",
        facts: [{ category: "path", evidence: "main.ets" }],
        recommendedAction: "rebuildIndex" as const,
      })),
      rebuildWorkspaceIndex,
      refreshWorkspaceIndex,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("{Control>}b{/Control}");
    await user.click(await screen.findByRole("button", { name: /Go to Definition miss:/ }));
    await user.click(await screen.findByRole("button", { name: "Rebuild Index" }));

    expect(rebuildWorkspaceIndex).toHaveBeenCalledWith("C:\\samples\\DemoWorkspace");
    await waitFor(() => expect(refreshWorkspaceIndex).toHaveBeenCalledWith("C:\\samples\\DemoWorkspace"));
    expect(await screen.findByText("Index: ready (1 files)")).toBeVisible();
  });

  it("opens Settings from the explain panel", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "DemoWorkspace",
        rootPath: "C:/samples/DemoWorkspace",
        files: ["C:/samples/DemoWorkspace/src/main.ets"],
      }),
      openFile: async () => "const value = missingTarget;\n",
      gotoDefinition: vi.fn(async () => null),
      gotoDefinitionCandidates: vi.fn(async () => []),
      explainWorkspaceIndexQuery: vi.fn(async () => ({
        status: "sdkNotReady" as const,
        message: "SDK API index is not ready for this workspace",
        facts: [{ category: "sdk", evidence: "missing" }],
        recommendedAction: "configureSdk" as const,
      })),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.click(await screen.findByLabelText("Editor Content"));
    await user.keyboard("{Control>}b{/Control}");
    await user.click(await screen.findByRole("button", { name: /Go to Definition miss:/ }));
    await user.click(await screen.findByRole("button", { name: "Open Settings" }));

    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeVisible();
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

  it("adds indexed file symbols to completion when language completions are empty", async () => {
    const user = userEvent.setup();
    const queryWorkspaceFileSymbolsWithReadiness = vi.fn(async () => fileSymbolEnvelope([
      {
        id: "symbol:C:/samples/DemoWorkspace/src/main.ets:4:3",
        source: "symbol" as const,
        kind: "method",
        title: "indexedBuild",
        subtitle: "Index · C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 4,
        column: 3,
        score: 0,
        freshness: "ready" as const,
      },
    ]));
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
      queryWorkspaceFileSymbolsWithReadiness,
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>} {/Control}");

    await waitFor(() => expect(queryWorkspaceFileSymbolsWithReadiness).toHaveBeenCalledWith(
      "C:\\samples\\DemoWorkspace",
      "C:\\samples\\DemoWorkspace\\src\\main.ets",
      "",
      80,
    ));
    const popup = await screen.findByRole("listbox", { name: "Code Completion" });
    expect(within(popup).getByRole("option", { name: /indexedBuild\(\)/ })).toBeVisible();
  });

  it("opens indexed completion when language service completion is unavailable", async () => {
    const user = userEvent.setup();
    const queryWorkspaceFileSymbolsWithReadiness = vi.fn(async () => fileSymbolEnvelope([
      {
        id: "symbol:C:/samples/DemoWorkspace/src/main.ets:4:3",
        source: "symbol" as const,
        kind: "method",
        title: "indexedBuild",
        subtitle: "Index · C:/samples/DemoWorkspace/src/main.ets",
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 4,
        column: 3,
        score: 0,
        freshness: "ready" as const,
      },
    ]));
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
      queryWorkspaceFileSymbolsWithReadiness,
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });
    workspaceApi.completeSymbol = undefined;

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>} {/Control}");

    expect(await screen.findByRole("listbox", { name: "Code Completion" })).toBeVisible();
    expect(screen.getByRole("option", { name: /indexedBuild\(\)/ })).toBeVisible();
  });

  it("adds workspace indexed symbols and ArkTS keywords to completion", async () => {
    const user = userEvent.setup();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [{
        id: "class:C:/samples/DemoWorkspace/src/profile.ets:3:8",
        source: "class" as const,
        kind: "class",
        title: "PrivateProfile",
        subtitle: "C:/samples/DemoWorkspace/src/profile.ets",
        path: "C:/samples/DemoWorkspace/src/profile.ets",
        line: 3,
        column: 8,
        score: 0,
        freshness: "ready" as const,
      }],
      readiness: {
        rootPath: "C:/samples/DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
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
      completeSymbol: vi.fn(async () => []),
      queryWorkspaceCandidatesWithReadiness,
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.keyboard("p");
    await user.keyboard("r");
    await user.keyboard("i");
    await user.keyboard("{Control>} {/Control}");

    await waitFor(() => expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith(
      "C:\\samples\\DemoWorkspace",
      "pri",
      "all",
      80,
    ));
    const popup = await screen.findByRole("listbox", { name: "Code Completion" });
    expect(within(popup).getByRole("option", { name: /PrivateProfile/ })).toBeVisible();
    expect(within(popup).getByRole("option", { name: /private/ })).toBeVisible();
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
        kind: "fallback",
        confidence: "fallback",
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
    await user.keyboard("{Control>}{F7}{/Control}");
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

  it("shows completion envelope explain for manual empty completion", async () => {
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
      semanticCompleteSymbol: vi.fn(async () => ({
        items: [],
        readiness: {
          rootPath: "C:/samples/DemoWorkspace",
          requestedGeneration: 4,
          servedGeneration: 3,
          state: "partial" as const,
          reason: "Completion waits for current file symbols",
          retryable: true,
        },
        explain: [
          "query:completion",
          "resultCount:0",
          "readiness:Partial",
          "reason:Completion waits for current file symbols",
        ],
      })),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content");
    await user.click(editor);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.keyboard("{Control>} {/Control}");

    expect(await screen.findByRole("status")).toHaveTextContent("Completion waits for current file symbols");
    expect(await screen.findByText("Completion empty")).toBeVisible();

    await user.click(await screen.findByRole("button", { name: /Open Index Diagnostics/i }));
    const dialog = await screen.findByRole("dialog", { name: "Index Diagnostics Center" });
    const queryExplain = within(dialog).getByRole("region", { name: "Query Explain" });
    expect(within(queryExplain).getByText("Completion waits for current file symbols")).toBeVisible();
    expect(within(queryExplain).getByText(/frontend .* completion/)).toBeVisible();
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
          kind: "fallback",
          confidence: "fallback",
        },
      ]),
      loadSettings: async () => defaultSettings(),
      saveSettings: async () => undefined,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.keyboard("{Control>}{F7}{/Control}");

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

  it("shows usages envelope explain when indexed usage lookup has no matches", async () => {
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
      queryUsagesWithReadiness: vi.fn(async () => ({
        items: [],
        readiness: {
          rootPath: "C:/samples/DemoWorkspace",
          requestedGeneration: 11,
          servedGeneration: 10,
          state: "partial" as const,
          reason: "Usage references are still being indexed for the current file",
          retryable: true,
        },
        explain: [
          "query:usages",
          "usedIndexes:WorkspaceIndex",
          "resultCount:0",
          "readiness:Partial",
          "reason:Usage references are still being indexed for the current file",
        ],
      })),
      findUsages: vi.fn(async () => []),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    await user.keyboard("{Control>}{F7}{/Control}");

    const queryPanel = await screen.findByLabelText("Editor Query Panel");
    expect(within(queryPanel).getByText("Usage references are still being indexed for the current file")).toBeVisible();
    expect(workspaceApi.findUsages).not.toHaveBeenCalled();
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

    expect(within(items[0]).getByText("app.json5")).toHaveClass("recent-file-result__title");
    expect(within(items[0]).getByText("AppScope/app.json5")).toHaveClass("recent-file-result__path");
    expect(within(items[1]).getByText("main.ets")).toHaveClass("recent-file-result__title");
    expect(within(items[1]).getByText("src/main.ets")).toHaveClass("recent-file-result__path");
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

  it("toggles Git Blame from the editor context menu", async () => {
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
    const editorContent = await screen.findByLabelText("Editor Content");

    await user.pointer({ keys: "[MouseRight]", target: editorContent });
    await user.click(await screen.findByRole("menuitem", { name: "Enable Git Blame" }));
    await waitFor(() => expect(container.querySelector(".cm-git-trace-marker")).toBeTruthy());

    await user.pointer({ keys: "[MouseRight]", target: editorContent });
    await user.click(await screen.findByRole("menuitem", { name: "Disable Git Blame" }));

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

  it("formats the active document from the keyboard shortcut", async () => {
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

    await user.keyboard("{Control>}{Alt>}l{/Alt}{/Control}");

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
    await user.type(screen.getByLabelText("Search Keyboard Shortcuts"), "Ctrl+F7");

    expect(screen.getByRole("row", { name: /Find Usages Navigation/i })).toBeVisible();
    expect(screen.queryByRole("row", { name: /Code Completion Editor/i })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search Keyboard Shortcuts"));
    await user.type(screen.getByLabelText("Search Keyboard Shortcuts"), "Ctrl+F12");

    expect(screen.getByRole("row", { name: /Show Current Class Methods Navigation/i })).toBeVisible();

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

  it("indexes SDK API symbols after applying SDK settings", async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async () => undefined);
    let taskStatusWatcher: ((status: WorkspaceIndexTaskStatus) => void) | null = null;
    const readySdkStatus: WorkspaceIndexTaskStatus = {
      taskId: "1:sdk",
      rootPath: "C:/samples/DemoWorkspace",
      kind: "sdk",
      status: "ready",
      reason: "sdk-apply",
      generation: 1,
      progressCurrent: 1,
      progressTotal: 1,
      symbolCount: 12,
    };
    const indexWorkspaceSdkSymbols = vi.fn(async () => {
      throw new Error("sync SDK indexing should not be used when submit is available");
    });
    const submitWorkspaceSdkIndex = vi.fn(async () => {
      taskStatusWatcher?.({
        ...readySdkStatus,
        taskId: "1:sdk",
        status: "running",
        progressCurrent: 0,
        symbolCount: undefined,
      });
      taskStatusWatcher?.(readySdkStatus);
      return { ...readySdkStatus, status: "queued", progressCurrent: 0, symbolCount: undefined };
    });
    const getWorkspaceIndexTaskStatuses = vi.fn(async () => [readySdkStatus]);
    const watchWorkspaceIndexTaskStatuses = vi.fn(async (_rootPath, onChange) => {
      taskStatusWatcher = onChange;
      return () => undefined;
    });
    const workspaceApi = createWorkspaceApi({
      saveSettings,
      indexWorkspaceSdkSymbols,
      submitWorkspaceSdkIndex,
      getWorkspaceIndexTaskStatuses,
      watchWorkspaceIndexTaskStatuses,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);
    await waitFor(() => expect(watchWorkspaceIndexTaskStatuses).toHaveBeenCalled());
    saveSettings.mockClear();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("tab", { name: "SDK & Tools" }));
    const sdkPath = await screen.findByLabelText("HarmonyOS / ArkTS SDK Path");
    await user.clear(sdkPath);
    await user.type(sdkPath, "D:/HarmonyOS/Sdk/default/openharmony");

    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submitWorkspaceSdkIndex).toHaveBeenCalledWith(
      expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace/),
      "D:/HarmonyOS/Sdk/default/openharmony",
      "settings",
    ));
    expect(indexWorkspaceSdkSymbols).not.toHaveBeenCalled();
    expect(await screen.findByText("SDK settings applied")).toBeVisible();
    expect(await screen.findByText("SDK API: ready (12 symbols)")).toBeVisible();
  });

  it("shows active project index task status from the initial task snapshot", async () => {
    const user = userEvent.setup();
    const runningStatus: WorkspaceIndexTaskStatus = {
      taskId: "1:open-workspace",
      rootPath: "C:/samples/DemoWorkspace",
      kind: "open-workspace",
      status: "running",
      reason: "open-workspace",
      generation: 1,
      progressCurrent: 0,
      progressTotal: 1,
    };
    const getWorkspaceIndexTaskStatuses = vi.fn(async () => [runningStatus]);
    const watchWorkspaceIndexTaskStatuses = vi.fn(async () => () => undefined);
    const workspaceApi = createWorkspaceApi({
      getWorkspaceIndexTaskStatuses,
      watchWorkspaceIndexTaskStatuses,
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user);

    await waitFor(() => expect(getWorkspaceIndexTaskStatuses).toHaveBeenCalledWith(expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace/)));
    expect(await screen.findByText("Index: running project (0/1)")).toBeVisible();
  });

  it("does not present a lazy opened workspace snapshot as a partial zero-file index", async () => {
    const user = userEvent.setup();
    const workspaceApi = createWorkspaceApi({
      openWorkspace: async (rootPath: string) => ({
        rootName: "LargeWorkspace",
        rootPath,
        files: [],
        scanSummary: {
          scannedFiles: 0,
          skippedEntries: 0,
          truncated: true,
          excludeRules: [".git", "node_modules", "oh_modules"],
        },
      }),
    });

    render(<AppShell workspaceApi={workspaceApi} />);

    await openProject(user, "C:/samples/LargeWorkspace");

    expect(await screen.findByText("Index: building project")).toBeVisible();
    expect(screen.queryByText("Index: partial (0 files)")).not.toBeInTheDocument();
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
