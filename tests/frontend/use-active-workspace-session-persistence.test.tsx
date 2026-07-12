import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useActiveWorkspaceSessionPersistence } from "@/components/layout/use-active-workspace-session-persistence";
import { createSettingsStore } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("useActiveWorkspaceSessionPersistence", () => {
  it("does not persist before settings are hydrated", () => {
    const saveSettings = vi.fn();
    const settingsRef = { current: createSettingsStore() };

    renderHook(() => useActiveWorkspaceSessionPersistence({
      activePath: "/workspace/A.ets",
      rootPath: "/workspace",
      settingsHydrated: false,
      settingsRef,
      workspaceApi: workspaceApi({ saveSettings }),
    }));

    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("persists the active file for the current workspace session", () => {
    const saveSettings = vi.fn();
    const settingsRef = { current: createSettingsStore() };

    renderHook(() => useActiveWorkspaceSessionPersistence({
      activePath: "/workspace/A.ets",
      rootPath: "/workspace",
      settingsHydrated: true,
      settingsRef,
      workspaceApi: workspaceApi({ saveSettings }),
    }));

    expect(settingsRef.current.state.settings.workspaceSessions["/workspace"]).toEqual({
      activeFilePath: "/workspace/A.ets",
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("skips duplicate persistence when the active file is unchanged", () => {
    const saveSettings = vi.fn();
    const settingsRef = { current: createSettingsStore() };
    settingsRef.current.update({
      workspaceSessions: {
        "/workspace": { activeFilePath: "/workspace/A.ets" },
      },
    });

    renderHook(() => useActiveWorkspaceSessionPersistence({
      activePath: "/workspace/A.ets",
      rootPath: "/workspace",
      settingsHydrated: true,
      settingsRef,
      workspaceApi: workspaceApi({ saveSettings }),
    }));

    expect(saveSettings).not.toHaveBeenCalled();
  });
});

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    loadDiff: vi.fn(),
    inspectEnvironment: vi.fn(),
    saveSettings: vi.fn(),
    loadSettings: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceApi;
}
