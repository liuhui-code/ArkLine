import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useSettingsController } from "@/components/layout/use-settings-controller";
import { createSettingsStore, defaultSettings, type AppSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("useSettingsController", () => {
  it("opens settings and refreshes the environment report", async () => {
    const inspectEnvironment = vi.fn(async () => environmentReport());
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({ inspectEnvironment }),
      onStatusChange,
    });

    await act(async () => {
      await result.current.openSettings();
    });

    expect(result.current.settingsVisible).toBe(true);
    expect(result.current.environmentReport?.tools[0]?.detail).toBe("/node");
    expect(onStatusChange).toHaveBeenCalledWith("Settings");
  });

  it("uses directory picker for SDK and node paths but file picker for semantic worker", async () => {
    const pickPath = vi.fn(async () => "/selected");
    const { result } = renderHarness({ workspaceApi: workspaceApi({ pickPath }) });

    await act(async () => {
      await result.current.pickSettingsPath("harmonySdkPath");
      await result.current.pickSettingsPath("semanticWorkerPath");
      await result.current.pickSettingsPath("nodePath");
    });

    expect(pickPath).toHaveBeenNthCalledWith(1, expect.objectContaining({ directory: true }));
    expect(pickPath).toHaveBeenNthCalledWith(2, expect.objectContaining({ directory: false }));
    expect(pickPath).toHaveBeenNthCalledWith(3, expect.objectContaining({ directory: true }));
  });

  it("applies settings, refreshes semantic state, and queues SDK indexing", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const refreshSemanticState = vi.fn(async () => undefined);
    const indexSdkSymbolsForSettings = vi.fn(async () => undefined);
    const onSettingsApplied = vi.fn();
    const onBeforeApply = vi.fn();
    const onStatusChange = vi.fn();
    const { result, settingsRef } = renderHarness({
      workspaceApi: workspaceApi({ saveSettings }),
      refreshSemanticState,
      indexSdkSymbolsForSettings,
      onSettingsApplied,
      onBeforeApply,
      onStatusChange,
    });
    const nextSettings = settings("/sdk");

    await act(async () => {
      await result.current.applySettings(nextSettings);
    });

    expect(saveSettings).toHaveBeenCalledWith(nextSettings);
    expect(settingsRef.current.state.settings.sdk.harmonySdkPath).toBe("/sdk");
    expect(refreshSemanticState).toHaveBeenCalledWith({ throwOnError: true });
    expect(indexSdkSymbolsForSettings).toHaveBeenCalledWith(nextSettings);
    expect(onSettingsApplied).toHaveBeenCalledWith(nextSettings);
    expect(onBeforeApply).toHaveBeenCalledTimes(1);
    expect(result.current.settingsApplyState).toBe("applied");
    expect(result.current.settingsSaveState).toBe("saved");
    expect(onStatusChange).toHaveBeenCalledWith("SDK settings applied");
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  const initialSettings = overrides.initialSettings ?? defaultSettings();
  const workspaceApiValue = overrides.workspaceApi ?? workspaceApi({});
  const refreshSemanticState = overrides.refreshSemanticState ?? vi.fn(async () => undefined);
  const indexSdkSymbolsForSettings = overrides.indexSdkSymbolsForSettings ?? vi.fn(async () => undefined);
  const onSettingsApplied = overrides.onSettingsApplied ?? vi.fn();
  const onBeforeApply = overrides.onBeforeApply ?? vi.fn();
  const onStatusChange = overrides.onStatusChange ?? vi.fn();
  const hook = renderHook(() => {
    const settingsRef = useRef(createSettingsStore(initialSettings));
    const controller = useSettingsController({
      workspaceApi: workspaceApiValue,
      settingsRef,
      refreshSemanticState,
      indexSdkSymbolsForSettings,
      onSettingsApplied,
      onBeforeApply,
      onStatusChange,
    });
    return { ...controller, settingsRef };
  });
  return {
    ...hook,
    get settingsRef() {
      return hook.result.current.settingsRef;
    },
  };
}

type HarnessOptions = {
  initialSettings: AppSettings;
  workspaceApi: WorkspaceApi;
  refreshSemanticState: (options?: { throwOnError?: boolean }) => Promise<void>;
  indexSdkSymbolsForSettings: (settings: AppSettings) => Promise<void>;
  onSettingsApplied: (settings: AppSettings) => void;
  onBeforeApply: () => void;
  onStatusChange: (message: string) => void;
};

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    loadDiff: vi.fn(),
    inspectEnvironment: vi.fn(async () => environmentReport()),
    saveSettings: vi.fn(async () => undefined),
    loadSettings: vi.fn(async () => defaultSettings()),
    ...overrides,
  } as unknown as WorkspaceApi;
}

function settings(harmonySdkPath: string): AppSettings {
  return {
    ...defaultSettings(),
    sdk: {
      ...defaultSettings().sdk,
      harmonySdkPath,
    },
  };
}

function environmentReport() {
  return {
    tools: [
      { name: "Node", available: true, detail: "/node" },
      { name: "Harmony SDK", available: true, detail: "/sdk" },
    ],
  };
}
