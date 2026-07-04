import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBuildControllerState } from "@/components/layout/use-build-controller-state";
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
