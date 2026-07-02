import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

async function openProject(user: ReturnType<typeof userEvent.setup>, path = "/workspace/Demo") {
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
  await user.clear(await screen.findByLabelText("Project Path"));
  await user.type(screen.getByLabelText("Project Path"), path);
  await user.click(screen.getByRole("button", { name: "Open Project" }));
  const thisWindow = screen.queryByRole("button", { name: "This Window" });
  if (thisWindow) {
    await user.click(thisWindow);
  }
}

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    pickWorkspaceRoot: async () => "/workspace/Demo",
    openWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: [
        "/workspace/Demo/hvigorw",
        "/workspace/Demo/build-profile.json5",
        "/workspace/Demo/oh-package.json5",
        "/workspace/Demo/hvigorfile.ts",
        "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
      ],
    }),
    openDemoWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: ["/workspace/Demo/entry/src/main/ets/pages/Index.ets"],
    }),
    openFile: async () => "",
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => ({ tools: [] }),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
    loadBuildConfigurations: async () => [],
    saveBuildConfigurations: async () => undefined,
    runTerminalCommand: async (request) => ({
      runId: request.runId,
      command: request.command,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      stopped: false,
    }),
    stopTerminalCommand: async () => undefined,
    createTerminalSession: async () => ({ id: "session-1", title: "zsh", cwd: "/workspace/Demo", shell: "zsh", status: "idle" }),
    listTerminalSessions: async () => [],
    writeTerminalInput: async () => undefined,
    resizeTerminalSession: async () => undefined,
    closeTerminalSession: async () => undefined,
    stopTerminalSession: async () => undefined,
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

describe("build tool window", () => {
  it("runs a HAP build from the top bar and shows success status", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({ runTerminalCommand })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    expect(await screen.findByRole("tab", { name: "Build" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon",
      cwd: "/workspace/Demo",
      source: "preset",
    })));
    expect(screen.getAllByText("Build succeeded").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Build Status")).toHaveTextContent("Build succeeded");
  });

  it("parses build diagnostics into Problems after a failed build", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "",
        stderr: "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.",
        exitCode: 1,
        durationMs: 90,
        stopped: false,
      }),
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));
    await waitFor(() => expect(screen.getAllByText("Build failed").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Problems" }));

    expect(screen.getByText("Property width does not exist.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Problems List")).getByText("build")).toBeInTheDocument();
  });

  it("lets the user stop a running build", async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Awaited<ReturnType<WorkspaceApi["runTerminalCommand"]>>) => void) | null = null;
    const stopTerminalCommand = vi.fn(async () => undefined);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: (request) => new Promise((resolve) => {
        resolveRun = resolve;
        void request;
      }),
      stopTerminalCommand,
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));
    await user.click(await screen.findByRole("button", { name: "Stop Build" }));

    expect(stopTerminalCommand).toHaveBeenCalled();
    await act(async () => {
      resolveRun?.({
        runId: "build-1",
        command: "",
        stdout: "",
        stderr: "",
        exitCode: null,
        durationMs: 10,
        stopped: true,
      });
    });
  });

  it("shows build pipeline stages while a build is running", async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Awaited<ReturnType<WorkspaceApi["runTerminalCommand"]>>) => void) | null = null;
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: (request) => new Promise((resolve) => {
        resolveRun = resolve;
        void request;
      }),
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    const pipeline = await screen.findByLabelText("Build Pipeline");
    expect(within(pipeline).getByText("Preflight")).toBeInTheDocument();
    expect(within(pipeline).getByText("Complete")).toBeInTheDocument();
    expect(within(pipeline).getByText("Build")).toBeInTheDocument();
    expect(within(pipeline).getByText("Running")).toBeInTheDocument();
    expect(within(pipeline).getByText("Diagnostics")).toBeInTheDocument();
    expect(within(pipeline).getAllByText("Pending").length).toBeGreaterThan(0);

    await act(async () => {
      resolveRun?.({
        runId: "build-1",
        command: "",
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        stopped: false,
      });
    });
  });

  it("shows diagnostics and artifact stages after a successful build", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "Generated artifact: /workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        stderr: "",
        exitCode: 0,
        durationMs: 55,
        stopped: false,
      }),
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    const pipeline = await screen.findByLabelText("Build Pipeline");
    await waitFor(() => expect(within(pipeline).getByText("Artifacts")).toBeInTheDocument());
    expect(within(pipeline).getAllByText("Complete").length).toBeGreaterThanOrEqual(4);
  });

  it("uses the active file module for HAP builds", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand,
      openWorkspace: async () => ({
        rootName: "Demo",
        rootPath: "/workspace/Demo",
        files: [
          "/workspace/Demo/hvigorw",
          "/workspace/Demo/build-profile.json5",
          "/workspace/Demo/hvigorfile.ts",
          "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
          "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
        ],
      }),
    })} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "Feature.ets" }));
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=feature@default -p product=default -p buildMode=debug --no-daemon",
    })));
  });

  it("uses the selected project directory module for HAP builds", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand,
      openWorkspace: async () => ({
        rootName: "Demo",
        rootPath: "/workspace/Demo",
        files: [
          "/workspace/Demo/hvigorw",
          "/workspace/Demo/build-profile.json5",
          "/workspace/Demo/hvigorfile.ts",
          "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
          "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
        ],
      }),
    })} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "feature" }));
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=feature@default -p product=default -p buildMode=debug --no-daemon",
    })));
  });

  it("shows detected modules as module choices", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "Demo",
        rootPath: "/workspace/Demo",
        files: [
          "/workspace/Demo/hvigorw",
          "/workspace/Demo/build-profile.json5",
          "/workspace/Demo/hvigorfile.ts",
          "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
          "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
        ],
      }),
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));

    const moduleSelect = await screen.findByLabelText("Build Module");
    expect(within(moduleSelect).getByRole("option", { name: "entry" })).toBeInTheDocument();
    expect(within(moduleSelect).getByRole("option", { name: "feature" })).toBeInTheDocument();
  });

  it("loads build-profile products into the Product select", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      openFile: async (path) => path.endsWith("build-profile.json5")
        ? `{ app: { products: [{ name: "default" }, { name: "china" }] } }`
        : "",
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));

    const productSelect = await screen.findByLabelText("Build Product");
    expect(within(productSelect).getByRole("option", { name: "default" })).toBeInTheDocument();
    expect(within(productSelect).getByRole("option", { name: "china" })).toBeInTheDocument();
  });

  it("uses the selected build product in the Hvigor command", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand,
      openFile: async (path) => path.endsWith("build-profile.json5")
        ? `{ app: { products: [{ name: "default" }, { name: "china" }] } }`
        : "",
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));
    await user.selectOptions(await screen.findByLabelText("Build Product"), "china");
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=entry@china -p product=china -p buildMode=debug --no-daemon",
    })));
  });

  it("shows preflight errors instead of starting a build without an Hvigor wrapper", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand,
      openWorkspace: async () => ({
        rootName: "Demo",
        rootPath: "/workspace/Demo",
        files: [
          "/workspace/Demo/build-profile.json5",
          "/workspace/Demo/hvigorfile.ts",
          "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        ],
      }),
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    await waitFor(() => expect(screen.getAllByText("Build preflight failed").length).toBeGreaterThan(0));
    expect(screen.getByText("Hvigor wrapper is missing. Add hvigorw or hvigorw.bat to the project root.")).toBeInTheDocument();
    expect(runTerminalCommand).not.toHaveBeenCalled();
  });

  it("saves a build configuration and runs with the selected configuration values", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({ runTerminalCommand })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));
    await user.selectOptions(screen.getByLabelText("Build Mode"), "release");
    await user.click(screen.getByRole("button", { name: "Save Config" }));
    await user.selectOptions(screen.getByLabelText("Build Mode"), "debug");
    await user.selectOptions(screen.getByLabelText("Build Configuration"), "HAP entry release");
    await user.click(screen.getByRole("button", { name: "Run Build Configuration" }));

    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=release --no-daemon",
    })));
  });

  it("persists saved build configurations for the current workspace", async () => {
    const user = userEvent.setup();
    const saveBuildConfigurations = vi.fn(async () => undefined);
    render(<AppShell workspaceApi={createWorkspaceApi({ saveBuildConfigurations })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));
    await user.selectOptions(screen.getByLabelText("Build Mode"), "release");
    await user.click(screen.getByRole("button", { name: "Save Config" }));

    await waitFor(() => expect(saveBuildConfigurations).toHaveBeenCalledWith("/workspace/Demo", [
      expect.objectContaining({
        name: "HAP entry release",
        buildMode: "release",
      }),
    ]));
  });

  it("loads saved build configurations when opening a workspace", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      loadBuildConfigurations: async () => [{
        id: "hap-entry-release",
        name: "HAP entry release",
        target: "hap",
        moduleName: "entry",
        product: "default",
        buildMode: "release",
        fastMode: false,
      }],
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));

    expect(within(screen.getByLabelText("Build Configuration")).getByRole("option", { name: "HAP entry release" })).toBeInTheDocument();
  });

  it("marks the selected build configuration as modified when form values diverge", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      loadBuildConfigurations: async () => [{
        id: "hap-entry-release",
        name: "HAP entry release",
        target: "hap",
        moduleName: "entry",
        product: "default",
        buildMode: "release",
        fastMode: false,
      }],
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));
    await user.selectOptions(screen.getByLabelText("Build Configuration"), "HAP entry release");
    await user.selectOptions(screen.getByLabelText("Build Mode"), "debug");

    expect(screen.getByText("Modified")).toBeInTheDocument();
  });

  it("copies and deletes build configurations", async () => {
    const user = userEvent.setup();
    const saveBuildConfigurations = vi.fn(async () => undefined);
    render(<AppShell workspaceApi={createWorkspaceApi({
      saveBuildConfigurations,
      loadBuildConfigurations: async () => [{
        id: "hap-entry-release",
        name: "HAP entry release",
        target: "hap",
        moduleName: "entry",
        product: "default",
        buildMode: "release",
        fastMode: false,
      }],
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));
    await user.selectOptions(screen.getByLabelText("Build Configuration"), "HAP entry release");
    await user.click(screen.getByRole("button", { name: "Copy Config" }));

    expect(within(screen.getByLabelText("Build Configuration")).getByRole("option", { name: "HAP entry release copy" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Config" }));

    expect(within(screen.getByLabelText("Build Configuration")).queryByRole("option", { name: "HAP entry release copy" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Build Configuration")).toHaveValue("");
    await waitFor(() => expect(saveBuildConfigurations).toHaveBeenLastCalledWith("/workspace/Demo", [
      expect.objectContaining({ name: "HAP entry release" }),
    ]));
  });
});
