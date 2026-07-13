import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetForegroundIndexScheduleGate } from "@/components/layout/foreground-index-schedule-gate";
import { useWorkspaceSession } from "@/components/layout/use-workspace-session";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

describe("useWorkspaceSession", () => {
  afterEach(() => {
    resetForegroundIndexScheduleGate();
  });

  it("applies workspace snapshots and persists recent projects", () => {
    const onOpenWorkspaceIndex = vi.fn();
    const onPersistRecentProjects = vi.fn();
    const { result } = renderHook(() => useWorkspaceSession(options({
      onOpenWorkspaceIndex,
      onPersistRecentProjects,
    })));

    act(() => result.current.applyWorkspaceSnapshot(workspace({ rootPath: "/workspace/a" })));
    expect(result.current.workspace?.rootPath).toBe("/workspace/a");
    expect(onOpenWorkspaceIndex).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "/workspace/a" }));
    expect(result.current.recentProjects).toEqual(["/workspace/a"]);
    expect(onPersistRecentProjects).toHaveBeenCalledWith(["/workspace/a"]);

    act(() => result.current.applyWorkspaceSnapshot(workspace({ rootPath: "/workspace/b" })));
    expect(result.current.recentProjects).toEqual(["/workspace/b", "/workspace/a"]);
  });

  it("applies index refresh results to the visible file tree", () => {
    const onReplaceWorkspaceIndexState = vi.fn();
    const { result } = renderHook(() => useWorkspaceSession(options({ onReplaceWorkspaceIndexState })));

    act(() => result.current.applyWorkspaceSnapshot(workspace({ rootPath: "/workspace" })));
    act(() => result.current.applyWorkspaceIndexRefreshResult({
      state: indexState({ filePaths: ["/workspace/src/B.ets", "/workspace/src/A.ets"] }),
      changed: true,
      addedPaths: [],
      removedPaths: [],
    }));

    expect(onReplaceWorkspaceIndexState).toHaveBeenCalledWith(expect.objectContaining({
      filePaths: ["/workspace/src/B.ets", "/workspace/src/A.ets"],
    }));
    expect(result.current.workspace?.visibleFiles).toEqual(["/workspace/src/A.ets", "/workspace/src/B.ets"]);
    expect(result.current.workspace?.fileTree.length).toBeGreaterThan(0);
  });

  it("includes newly opened workspace files and updates the durable index", async () => {
    const onOpenWorkspaceIndex = vi.fn();
    const onReplaceWorkspaceIndexState = vi.fn();
    const updateWorkspaceIndexFiles = vi.fn(async () => indexState({ filePaths: ["/workspace/src/A.ets"] }));
    const { result } = renderHook(() => useWorkspaceSession(options({
      workspaceApi: workspaceApi({ updateWorkspaceIndexFiles }),
      onOpenWorkspaceIndex,
      onReplaceWorkspaceIndexState,
    })));

    act(() => result.current.applyWorkspaceSnapshot(workspace({ rootPath: "/workspace" })));
    act(() => result.current.includeVisibleWorkspaceFile("/workspace/src/A.ets"));

    expect(result.current.workspace?.visibleFiles).toEqual(["/workspace/src/A.ets"]);
    expect(onOpenWorkspaceIndex).toHaveBeenLastCalledWith(expect.objectContaining({
      visibleFiles: ["/workspace/src/A.ets"],
    }));
    await waitFor(() => expect(updateWorkspaceIndexFiles).toHaveBeenCalledWith("/workspace", ["/workspace/src/A.ets"], []));
    expect(onReplaceWorkspaceIndexState).toHaveBeenCalledWith(expect.objectContaining({
      filePaths: ["/workspace/src/A.ets"],
    }));
  });

  it("falls back to visible-file scheduling when index file update is unavailable", () => {
    const scheduleVisibleFilesIndex = vi.fn(async () => undefined);
    const { result } = renderHook(() => useWorkspaceSession(options({
      workspaceApi: workspaceApi({ scheduleVisibleFilesIndex }),
    })));

    act(() => result.current.applyWorkspaceSnapshot(workspace({ rootPath: "/workspace" })));
    act(() => result.current.includeVisibleWorkspaceFile("/workspace/src/A.ets"));

    expect(scheduleVisibleFilesIndex).toHaveBeenCalledWith("/workspace", ["/workspace/src/A.ets"]);
  });

  it("deduplicates rapid visible-file indexing while preserving newly visible files", () => {
    const scheduleVisibleFilesIndex = vi.fn(async () => undefined);
    const { result } = renderHook(() => useWorkspaceSession(options({
      workspaceApi: workspaceApi({ scheduleVisibleFilesIndex }),
    })));

    act(() => result.current.scheduleVisibleFilesIndex("/workspace", [
      "/workspace/src/B.ets",
      "/workspace/src/A.ets",
    ]));
    act(() => result.current.scheduleVisibleFilesIndex("/workspace", [
      "/workspace/src/A.ets",
      "/workspace/src/C.ets",
    ]));

    expect(scheduleVisibleFilesIndex).toHaveBeenNthCalledWith(1, "/workspace", [
      "/workspace/src/A.ets",
      "/workspace/src/B.ets",
    ]);
    expect(scheduleVisibleFilesIndex).toHaveBeenNthCalledWith(2, "/workspace", [
      "/workspace/src/C.ets",
    ]);
  });
});

function options(overrides: Partial<Parameters<typeof useWorkspaceSession>[0]> = {}) {
  return {
    workspaceApi: workspaceApi({}),
    onOpenWorkspaceIndex: vi.fn(),
    onReplaceWorkspaceIndexState: vi.fn(),
    onPersistRecentProjects: vi.fn(),
    onStatusChange: vi.fn(),
    ...overrides,
  };
}

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

function workspace(input: Partial<WorkspaceViewModel>): WorkspaceViewModel {
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
    ...input,
  };
}

function indexState(input: Partial<WorkspaceIndexState>): WorkspaceIndexState {
  return {
    status: "ready",
    rootPath: "/workspace",
    filePaths: [],
    symbols: [],
    indexedAt: 1,
    partialReason: null,
    queryReadiness: null,
    ...input,
  };
}
