import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useProjectTreeActions } from "@/components/layout/use-project-tree-actions";
import type { WorkspaceApi, WorkspaceDirectoryEntry, WorkspaceViewModel } from "@/features/workspace/workspace-api";

describe("useProjectTreeActions", () => {
  it("loads and normalizes lazy project tree children", async () => {
    const api = workspaceApi({
      listWorkspaceDirectory: vi.fn(async () => [
        directoryEntry({ path: "/workspace//src/Entry.ets", name: "Entry.ets", kind: "file" }),
      ]),
    });
    const { result } = renderHook(() => useProjectTreeActions({
      workspaceApi: api,
      onStatusChange: vi.fn(),
    }));

    await act(async () => {
      await result.current.loadProjectDirectory("/workspace", "/workspace//src");
    });

    expect(api.listWorkspaceDirectory).toHaveBeenCalledWith("/workspace", "/workspace/src");
    expect(result.current.projectTreeChildren["/workspace/src"]).toEqual([
      directoryEntry({ path: "/workspace/src/Entry.ets", name: "Entry.ets", kind: "file" }),
    ]);
    expect(result.current.projectTreeLoadingPaths.size).toBe(0);
  });

  it("reports project tree load failures", async () => {
    const onStatusChange = vi.fn();
    const api = workspaceApi({
      listWorkspaceDirectory: vi.fn(async () => {
        throw new Error("permission denied");
      }),
    });
    const { result } = renderHook(() => useProjectTreeActions({ workspaceApi: api, onStatusChange }));

    await act(async () => {
      await result.current.loadProjectDirectory("/workspace", "/workspace/src");
    });

    expect(onStatusChange).toHaveBeenCalledWith("Project tree failed: permission denied");
    expect(result.current.projectTreeLoadingPaths.size).toBe(0);
  });

  it("loads a directory for the active workspace only when it has not been loaded", async () => {
    const listWorkspaceDirectory = vi.fn(async () => [
      directoryEntry({ path: "/workspace/src/A.ets", name: "A.ets", kind: "file" }),
    ]);
    const { result } = renderHook(() => useProjectTreeActions({
      workspaceApi: workspaceApi({ listWorkspaceDirectory }),
      onStatusChange: vi.fn(),
    }));
    const activeWorkspace = workspace();

    act(() => {
      result.current.loadProjectDirectoryForWorkspace(null, "/workspace/src");
    });
    expect(listWorkspaceDirectory).not.toHaveBeenCalled();

    act(() => {
      result.current.loadProjectDirectoryForWorkspace(activeWorkspace, "/workspace/src");
    });
    await waitFor(() => expect(listWorkspaceDirectory).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.loadProjectDirectoryForWorkspace(activeWorkspace, "/workspace/src");
    });
    expect(listWorkspaceDirectory).toHaveBeenCalledTimes(1);
  });

  it("resets selected project path and lazy tree state", async () => {
    const { result } = renderHook(() => useProjectTreeActions({
      workspaceApi: workspaceApi({
        listWorkspaceDirectory: vi.fn(async () => [
          directoryEntry({ path: "/workspace/src/A.ets", name: "A.ets", kind: "file" }),
        ]),
      }),
      onStatusChange: vi.fn(),
    }));

    await act(async () => {
      result.current.setSelectedProjectPath("/workspace/src/A.ets");
      await result.current.loadProjectDirectory("/workspace", "/workspace/src");
    });

    expect(result.current.selectedProjectPath).toBe("/workspace/src/A.ets");
    expect(Object.keys(result.current.projectTreeChildren)).toEqual(["/workspace/src"]);

    act(() => result.current.resetProjectTree());
    expect(result.current.selectedProjectPath).toBeNull();
    expect(result.current.projectTreeChildren).toEqual({});
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

function directoryEntry(input: Partial<WorkspaceDirectoryEntry>): WorkspaceDirectoryEntry {
  return {
    path: "/workspace/src",
    name: "src",
    kind: "directory",
    excluded: false,
    hasChildren: false,
    ...input,
  };
}

function workspace(): WorkspaceViewModel {
  return {
    rootName: "workspace",
    rootPath: "/workspace",
    visibleFiles: [],
    fileTree: [],
    scanSummary: {
      scannedFiles: 0,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}
