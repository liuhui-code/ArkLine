import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVE_SESSION_SAVE_DELAY_MS,
  useActiveWorkspaceSessionPersistence,
} from "@/components/layout/use-active-workspace-session-persistence";
import { createSettingsStore } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("useActiveWorkspaceSessionPersistence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    vi.useFakeTimers();
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
    expect(saveSettings).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(ACTIVE_SESSION_SAVE_DELAY_MS));
    expect(saveSettings).toHaveBeenCalledTimes(1);
  });

  it("coalesces rapid file switches into one settings write", () => {
    vi.useFakeTimers();
    const saveSettings = vi.fn();
    const settingsRef = { current: createSettingsStore() };
    const api = workspaceApi({ saveSettings });
    const { rerender } = renderHook(
      ({ activePath }) => useActiveWorkspaceSessionPersistence({
        activePath,
        rootPath: "/workspace",
        settingsHydrated: true,
        settingsRef,
        workspaceApi: api,
      }),
      { initialProps: { activePath: "/workspace/A.ets" } },
    );

    rerender({ activePath: "/workspace/B.ets" });
    rerender({ activePath: "/workspace/C.ets" });
    act(() => vi.advanceTimersByTime(ACTIVE_SESSION_SAVE_DELAY_MS));

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(settingsRef.current.state.settings.workspaceSessions["/workspace"]).toEqual({
      activeFilePath: "/workspace/C.ets",
    });
  });

  it("flushes a pending active file when the shell unmounts", () => {
    vi.useFakeTimers();
    const saveSettings = vi.fn();
    const settingsRef = { current: createSettingsStore() };
    const { unmount } = renderHook(() => useActiveWorkspaceSessionPersistence({
      activePath: "/workspace/Last.ets",
      rootPath: "/workspace",
      settingsHydrated: true,
      settingsRef,
      workspaceApi: workspaceApi({ saveSettings }),
    }));

    unmount();

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(settingsRef.current.state.settings.workspaceSessions["/workspace"]).toEqual({
      activeFilePath: "/workspace/Last.ets",
    });
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
