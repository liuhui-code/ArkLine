import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBuildControllerState } from "@/components/layout/use-build-controller-state";
import type { BuildEnvironmentRequest } from "@/features/build/build-environment-request";
import type { ProblemItem } from "@/features/problems/problems-store";
import { defaultSettings, type AppSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";

describe("useBuildControllerState", () => {
  it("detects Harmony modules and build-profile products", async () => {
    const openFile = vi.fn(async () => "products: [{ name: 'default' }, { name: 'beta' }]");
    const { result } = renderHarness({
      workspaceApi: workspaceApi({ openFile }),
      selectedProjectPath: "/project/feature/src/main/ets/Page.ets",
    });

    await waitFor(() => {
      expect(result.current.buildState.products).toEqual(["default", "beta"]);
    });

    expect(result.current.buildProject?.modules).toEqual(["entry", "feature"]);
    expect(result.current.buildState.moduleName).toBe("feature");
    expect(openFile).toHaveBeenCalledWith("/project/build-profile.json5");
  });

  it("uses modules declared in build-profile while the tree is incomplete", async () => {
    const openFile = vi.fn(async () => "{ modules: [{ name: 'feature' }], products: [{ name: 'default' }] }");
    const { result } = renderHarness({
      workspace: {
        ...workspace(),
        visibleFiles: ["/project/hvigorw", "/project/hvigorfile.ts", "/project/build-profile.json5"],
      },
      workspaceApi: workspaceApi({ openFile }),
    });

    await waitFor(() => {
      expect(result.current.buildProject?.modules).toEqual(["feature"]);
    });
    expect(result.current.buildProject?.defaultModule).toBe("feature");
  });

  it("loads and saves build configurations through the workspace api", async () => {
    const loadBuildConfigurations = vi.fn(async () => [configuration("entry-debug")]);
    const saveBuildConfigurations = vi.fn(async () => undefined);
    const showBuild = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({ loadBuildConfigurations, saveBuildConfigurations }),
      showBuild,
    });

    await act(async () => {
      await result.current.loadBuildConfigurationsForRoot("/project");
    });
    await act(async () => {
      await result.current.saveBuildConfiguration();
    });

    expect(loadBuildConfigurations).toHaveBeenCalledWith("/project");
    expect(saveBuildConfigurations).toHaveBeenCalledWith("/project", expect.any(Array));
    expect(showBuild).toHaveBeenCalledTimes(1);
  });

  it("runs a successful build and forwards diagnostics to problems", async () => {
    const diagnostic = problem({ source: "build", message: "Build warning", severity: "warning" });
    const runTerminalCommand = vi.fn(async () => ({
      runId: "build-1",
      command: "./hvigorw --mode module -p module=entry assembleHap --build-mode debug",
      stdout: "WARN: /project/entry/src/main/ets/Index.ets:2:3 Build warning",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      stopped: false,
    }));
    const replaceBuildProblems = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({ runTerminalCommand }),
      replaceBuildProblems,
      onStatusChange,
    });

    await act(async () => {
      result.current.updateBuildState({ moduleName: "entry" });
      await result.current.runBuild();
    });

    expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      runId: "build-1",
      cwd: "/project",
      source: "preset",
    }));
    expect(replaceBuildProblems).toHaveBeenCalledWith(expect.any(Array));
    expect(result.current.buildState.status).toBe("success");
    expect(onStatusChange).toHaveBeenLastCalledWith("Build succeeded");
    expect(replaceBuildProblems.mock.calls[0]?.[0]).toEqual(expect.not.arrayContaining([diagnostic]));
  });

  it("uses one resolved environment for build preflight and Hvigor", async () => {
    const resolveBuildEnvironment = vi.fn(async (_request: BuildEnvironmentRequest) => ({
      canBuild: true,
      nodePath: "/tools/node",
      sdkPath: "/tools/sdk",
      pathEntries: ["/tools/node", "/tools/sdk/toolchains"],
      environment: {
        HOS_SDK_HOME: "/tools/sdk",
        NODE_HOME: "/tools/node",
      },
      checks: [
        { name: "node", available: true, detail: "Node ready" },
        { name: "harmonySdk", available: true, detail: "SDK ready" },
      ],
    }));
    const runTerminalCommand = vi.fn(async () => ({
      runId: "build-1",
      command: "./hvigorw assembleHap",
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      stopped: false,
    }));
    const { result } = renderHarness({
      workspaceApi: workspaceApi({ resolveBuildEnvironment, runTerminalCommand }),
    });

    await act(async () => {
      await result.current.runBuild();
    });

    expect(resolveBuildEnvironment).toHaveBeenCalledWith({
      rootPath: "/project",
      harmonySdkPath: "",
      nodePath: "",
      autoDetect: true,
    });
    expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      pathEntries: ["/tools/node", "/tools/sdk/toolchains"],
      environment: { HOS_SDK_HOME: "/tools/sdk", NODE_HOME: "/tools/node" },
    }));
  });

  it("restores missing ohpm dependencies before starting Hvigor", async () => {
    const ohpm = "/Applications/DevEco-Studio.app/Contents/tools/ohpm/bin/ohpm";
    const runTerminalCommand = vi.fn(async (request) => ({
      runId: request.runId,
      command: request.command,
      stdout: request.program === ohpm ? "Install dependencies successful" : "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      stopped: false,
    }));
    const resolveBuildEnvironment = vi.fn(async () => ({
      canBuild: true,
      hvigorCommand: "./hvigorw",
      hvigorSource: "project-wrapper" as const,
      ohpmCommand: ohpm,
      dependencyRestoreRequired: true,
      nodePath: "/tools/node",
      sdkPath: "/tools/sdk",
      pathEntries: ["/tools/node"],
      environment: {},
      checks: [
        { name: "hvigor", available: true, detail: "Wrapper ready" },
        { name: "node", available: true, detail: "Node ready" },
        { name: "harmonySdk", available: true, detail: "SDK ready" },
        { name: "ohpm", available: true, detail: "Dependency restore ready" },
      ],
    }));
    const { result } = renderHarness({
      workspaceApi: workspaceApi({ resolveBuildEnvironment, runTerminalCommand }),
    });

    await act(async () => {
      await result.current.runBuild();
    });

    expect(runTerminalCommand).toHaveBeenCalledTimes(2);
    expect(runTerminalCommand.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      program: ohpm,
      args: ["install", "--all"],
      cwd: "/project",
    }));
    expect(runTerminalCommand.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      program: "./hvigorw",
    }));
  });

  it("builds a lazily opened project from native project inspection", async () => {
    const runTerminalCommand = vi.fn(async () => ({
      runId: "build-1",
      command: "./hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon",
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      stopped: false,
    }));
    const inspectHarmonyBuildProject = vi.fn(async () => ({
      rootPath: "/project",
      isHarmonyProject: true,
      hasHvigorWrapper: true,
      hvigorWrapperCommand: "./hvigorw",
      hasHvigorFile: true,
      hasBuildProfile: true,
      hasOhPackage: true,
      modules: ["entry"],
      defaultModule: "entry",
      products: ["china"],
      defaultProduct: "china",
      productSigning: [{ product: "china", signingConfig: "default", ready: true, issues: [] }],
    }));
    const { result } = renderHarness({
      workspace: { ...workspace(), visibleFiles: [], fileTree: [] },
      workspaceApi: workspaceApi({ inspectHarmonyBuildProject, runTerminalCommand }),
    });

    await act(async () => {
      await result.current.runBuild();
    });

    expect(inspectHarmonyBuildProject).toHaveBeenCalledWith("/project/entry/src/main/ets/Index.ets");
    expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw --mode module -p module=entry@china -p product=china -p buildMode=debug assembleHap --no-daemon",
      cwd: "/project",
    }));
    expect(result.current.buildState.status).toBe("success");
  });

  it("uses detected DevEco Hvigor when a real project has no wrapper", async () => {
    const devecoHvigor = "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw";
    const runTerminalCommand = vi.fn(async (request) => ({
      runId: request.runId,
      command: request.command,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      stopped: false,
    }));
    const inspectHarmonyBuildProject = vi.fn(async () => ({
      rootPath: "/project",
      isHarmonyProject: true,
      hasHvigorWrapper: false,
      hvigorWrapperCommand: null,
      hasHvigorFile: true,
      hasBuildProfile: true,
      hasOhPackage: true,
      modules: ["entry"],
      defaultModule: "entry",
      products: ["default"],
      defaultProduct: "default",
      productSigning: [{ product: "default", signingConfig: "default", ready: true, issues: [] }],
    }));
    const resolveBuildEnvironment = vi.fn(async () => ({
      canBuild: true,
      hvigorCommand: devecoHvigor,
      hvigorSource: "deveco" as const,
      nodePath: "/Applications/DevEco-Studio.app/Contents/tools/node/bin",
      sdkPath: "/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony",
      pathEntries: ["/Applications/DevEco-Studio.app/Contents/tools/node/bin"],
      environment: {
        NODE_HOME: "/Applications/DevEco-Studio.app/Contents/tools/node",
        DEVECO_SDK_HOME: "/Applications/DevEco-Studio.app/Contents/sdk",
      },
      checks: [
        { name: "hvigor", available: true, detail: "DevEco Hvigor ready" },
        { name: "node", available: true, detail: "Node ready" },
        { name: "harmonySdk", available: true, detail: "SDK ready" },
      ],
    }));
    const { result } = renderHarness({
      workspace: { ...workspace(), visibleFiles: [], fileTree: [] },
      workspaceApi: workspaceApi({ inspectHarmonyBuildProject, resolveBuildEnvironment, runTerminalCommand }),
    });

    await act(async () => {
      await result.current.runBuild();
    });

    expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      program: devecoHvigor,
      command: `${devecoHvigor} --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon`,
    }));
    expect(result.current.buildState.status).toBe("success");
  });

  it("builds from the detected Harmony project root when a parent workspace is open", async () => {
    const loadBuildConfigurations = vi.fn(async () => []);
    const resolveBuildEnvironment = vi.fn(async (_request: BuildEnvironmentRequest) => ({
      canBuild: true,
      nodePath: "/tools/node",
      sdkPath: "/tools/sdk",
      pathEntries: ["/tools/node", "/tools/sdk/toolchains"],
      environment: { HOS_SDK_HOME: "/tools/sdk", NODE_HOME: "/tools/node" },
      checks: [
        { name: "hvigor", available: true, detail: "Wrapper ready" },
        { name: "node", available: true, detail: "Node ready" },
        { name: "harmonySdk", available: true, detail: "SDK ready" },
      ],
    }));
    const runTerminalCommand = vi.fn(async () => ({
      runId: "build-1",
      command: "./hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon",
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      stopped: false,
    }));
    const inspectHarmonyBuildProject = vi.fn(async () => ({
      rootPath: "/repo/apps/Demo",
      isHarmonyProject: true,
      hasHvigorWrapper: true,
      hvigorWrapperCommand: "./hvigorw",
      hasHvigorFile: true,
      hasBuildProfile: true,
      hasOhPackage: true,
      modules: ["entry"],
      defaultModule: "entry",
      products: ["default"],
      defaultProduct: "default",
      productSigning: [{ product: "default", signingConfig: "default", ready: true, issues: [] }],
    }));
    const { result } = renderHarness({
      workspace: {
        ...workspace(),
        rootPath: "/repo",
        rootName: "repo",
        visibleFiles: [],
      },
      activePath: "/repo/apps/Demo/entry/src/main/ets/Index.ets",
      workspaceApi: workspaceApi({ inspectHarmonyBuildProject, loadBuildConfigurations, resolveBuildEnvironment, runTerminalCommand }),
    });

    await waitFor(() => {
      expect(result.current.buildProject?.rootPath).toBe("/repo/apps/Demo");
    });
    await act(async () => {
      await result.current.runBuild();
    });

    expect(inspectHarmonyBuildProject).toHaveBeenCalledWith("/repo/apps/Demo/entry/src/main/ets/Index.ets");
    expect(loadBuildConfigurations).toHaveBeenCalledWith("/repo/apps/Demo");
    expect(resolveBuildEnvironment).toHaveBeenCalled();
    expect(resolveBuildEnvironment.mock.calls.every(([request]) => request.rootPath === "/repo/apps/Demo")).toBe(true);
    expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo/apps/Demo",
      command: "./hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon",
    }));
    expect(result.current.buildState.status).toBe("success");
  });

  it("reports preflight failure when no workspace is open", async () => {
    const showBuild = vi.fn();
    const { result } = renderHarness({ workspace: null, showBuild });

    await act(async () => {
      await result.current.runBuild();
    });

    expect(result.current.buildState.status).toBe("failed");
    expect(result.current.buildState.message).toBe("Open a project before building");
    expect(showBuild).toHaveBeenCalledTimes(1);
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  const workspaceValue = "workspace" in overrides ? overrides.workspace ?? null : workspace();
  const workspaceApiValue = overrides.workspaceApi ?? workspaceApi({});
  const activePath = overrides.activePath ?? "/project/entry/src/main/ets/Index.ets";
  const selectedProjectPath = overrides.selectedProjectPath ?? null;
  const sdkSettings = overrides.sdkSettings ?? defaultSettings().sdk;
  const showBuild = overrides.showBuild ?? vi.fn();
  const replaceBuildProblems = overrides.replaceBuildProblems ?? vi.fn();
  const onStatusChange = overrides.onStatusChange ?? vi.fn();

  return renderHook(() => useBuildControllerState({
    workspace: workspaceValue,
    workspaceApi: workspaceApiValue,
    activePath,
    selectedProjectPath,
    sdkSettings,
    showBuild,
    replaceBuildProblems,
    onStatusChange,
  }));
}

type HarnessOptions = {
  workspace: WorkspaceViewModel | null;
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  selectedProjectPath: string | null;
  sdkSettings: AppSettings["sdk"];
  showBuild: () => void;
  replaceBuildProblems: (problems: ProblemItem[]) => void;
  onStatusChange: (message: string) => void;
};

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(async () => "products: [{ name: 'default' }]"),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    loadDiff: vi.fn(),
    loadSettings: vi.fn(async () => defaultSettings()),
    saveSettings: vi.fn(),
    loadBuildConfigurations: vi.fn(async () => []),
    saveBuildConfigurations: vi.fn(async () => undefined),
    runTerminalCommand: vi.fn(async () => ({
      runId: "build-1",
      command: "",
      stdout: "",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      stopped: false,
    })),
    stopTerminalCommand: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as WorkspaceApi;
}

function workspace(): WorkspaceViewModel {
  return {
    rootName: "project",
    rootPath: "/project",
    visibleFiles: [
      "/project/hvigorw",
      "/project/hvigorfile.ts",
      "/project/build-profile.json5",
      "/project/oh-package.json5",
      "/project/entry/src/main/ets/Index.ets",
      "/project/feature/src/main/ets/Page.ets",
    ],
    fileTree: [],
    scanSummary: {
      scannedFiles: 6,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}

function configuration(id: string) {
  return {
    id,
    name: "Entry Debug",
    target: "hap" as const,
    moduleName: "entry",
    product: "default",
    buildMode: "debug" as const,
    fastMode: false,
  };
}

function problem(overrides: Partial<ProblemItem> = {}): ProblemItem {
  return {
    source: "build",
    severity: "error",
    path: "/project/entry/src/main/ets/Index.ets",
    line: 1,
    column: 1,
    message: "Problem",
    ...overrides,
  };
}
