import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIndexDiagnosticsController } from "@/components/layout/use-index-diagnostics-controller";
import type { AppSettings } from "@/features/settings/settings-store";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-index-api-types";

describe("useIndexDiagnosticsController", () => {
  beforeEach(() => {
    workspaceIndexProjectionStore.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens diagnostics and loads health, task status, and current file readiness", async () => {
    const inspectWorkspaceIndex = vi.fn(async () => diagnostics());
    const getWorkspaceIndexTaskStatuses = vi.fn(async () => [taskStatus({ taskId: "task-1" })]);
    const getWorkspaceIndexFileReadiness = vi.fn(async () => readiness());
    const getWorkspaceIndexLayerReadiness = vi.fn(async () => layerReadiness());
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({
        inspectWorkspaceIndex,
        getWorkspaceIndexTaskStatuses,
        getWorkspaceIndexFileReadiness,
        getWorkspaceIndexLayerReadiness,
      }),
    })));

    await act(async () => {
      result.current.openIndexDiagnostics();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.indexDiagnosticsVisible).toBe(true);
    expect(result.current.indexDiagnostics?.fileCount).toBe(12);
    expect(result.current.workspaceIndexTaskStatuses).toHaveLength(1);
    expect(result.current.currentFileReadiness?.definitionAvailable).toBe(true);
    expect(result.current.layerReadiness?.layers).toHaveLength(2);
    expect(inspectWorkspaceIndex).toHaveBeenCalledWith("/workspace");
    expect(getWorkspaceIndexLayerReadiness).toHaveBeenCalledWith("/workspace", "/workspace/Entry.ets");
  });

  it("records explain miss details for the explain panel", async () => {
    const explainWorkspaceIndexQuery = vi.fn(async () => ({
      status: "notIndexed" as const,
      message: "No indexed evidence explains this query yet",
      recommendedAction: "rebuildIndex" as const,
      facts: [{ category: "query", evidence: "Entry.ets:4:9" }],
    }));
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({ explainWorkspaceIndexQuery }),
    })));

    let message: string | null = null;
    await act(async () => {
      message = await result.current.explainIndexMiss("definition", "Entry.ets:4:9", "/workspace/Entry.ets", 4, 9);
    });

    expect(message).toBe("No indexed evidence explains this query yet. Rebuild Index.");
    expect(result.current.latestExplainResult?.status).toBe("notIndexed");
    expect(result.current.latestExplainContext).toMatchObject({
      kind: "definition",
      query: "Entry.ets:4:9",
      path: "/workspace/Entry.ets",
    });
  });

  it("queues SDK indexing from settings and waits for ready status", async () => {
    const onStatusChange = vi.fn();
    const queued = taskStatus({ taskId: "sdk-1", kind: "sdk-index", status: "running" });
    const ready = taskStatus({ taskId: "sdk-1", kind: "sdk-index", status: "ready" });
    const submitWorkspaceSdkIndex = vi.fn(async () => queued);
    const getWorkspaceIndexTaskStatuses = vi.fn(async () => [ready]);
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({ submitWorkspaceSdkIndex, getWorkspaceIndexTaskStatuses }),
      onStatusChange,
    })));

    await act(async () => {
      await result.current.indexSdkSymbolsForSettings(settings("/sdk"));
      await waitForProjectionFlush();
    });

    expect(submitWorkspaceSdkIndex).toHaveBeenCalledWith("/workspace", "/sdk", "settings");
    expect(result.current.workspaceIndexTaskStatuses).toEqual([ready]);
    expect(onStatusChange).toHaveBeenCalledWith("SDK API index queued...");
  });

  it("refreshes layer readiness after terminal index task updates", async () => {
    const getWorkspaceIndexLayerReadiness = vi.fn(async () => layerReadiness());
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({ getWorkspaceIndexLayerReadiness }),
    })));

    await act(async () => {
      result.current.recordWorkspaceIndexTaskStatus(taskStatus({
        kind: "refresh-workspace",
        status: "ready",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getWorkspaceIndexLayerReadiness).toHaveBeenCalledWith("/workspace", "/workspace/Entry.ets");
    expect(result.current.layerReadiness?.layers).toHaveLength(2);
  });

  it("refreshes layer readiness after terminal task status snapshots", async () => {
    const getWorkspaceIndexTaskStatuses = vi.fn(async () => [
      taskStatus({ kind: "refresh-workspace", status: "ready" }),
    ]);
    const getWorkspaceIndexLayerReadiness = vi.fn(async () => layerReadiness());
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({
        getWorkspaceIndexTaskStatuses,
        getWorkspaceIndexLayerReadiness,
      }),
    })));

    await act(async () => {
      await result.current.refreshWorkspaceIndexTaskStatuses();
      await Promise.resolve();
    });

    expect(getWorkspaceIndexTaskStatuses).toHaveBeenCalledWith("/workspace");
    expect(getWorkspaceIndexLayerReadiness).toHaveBeenCalledWith("/workspace", "/workspace/Entry.ets");
    expect(result.current.layerReadiness?.layers).toHaveLength(2);
  });

  it("rebuilds project index from diagnostics and refreshes diagnostic evidence", async () => {
    const onStatusChange = vi.fn();
    const rebuildWorkspaceIndex = vi.fn(async () => undefined);
    const inspectWorkspaceIndex = vi.fn(async () => diagnostics());
    const getWorkspaceIndexTaskStatuses = vi.fn(async () => [
      taskStatus({ taskId: "rebuild-1", kind: "refresh-workspace", status: "running" }),
    ]);
    const getWorkspaceIndexLayerReadiness = vi.fn(async () => layerReadiness());
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({
        rebuildWorkspaceIndex,
        inspectWorkspaceIndex,
        getWorkspaceIndexTaskStatuses,
        getWorkspaceIndexLayerReadiness,
      }),
      onStatusChange,
    })));

    await act(async () => {
      await result.current.rebuildProjectIndexFromDiagnostics();
      await Promise.resolve();
    });

    expect(rebuildWorkspaceIndex).toHaveBeenCalledWith("/workspace");
    expect(inspectWorkspaceIndex).toHaveBeenCalledWith("/workspace");
    expect(getWorkspaceIndexTaskStatuses).toHaveBeenCalledWith("/workspace");
    expect(result.current.indexDiagnostics?.fileCount).toBe(12);
    expect(result.current.workspaceIndexTaskStatuses[0]?.taskId).toBe("rebuild-1");
    expect(onStatusChange).toHaveBeenCalledWith("Rebuild Project Index requested");
  });

  it("polls task statuses while diagnostics rebuild is active until terminal status", async () => {
    vi.useFakeTimers();
    const rebuildWorkspaceIndex = vi.fn(async () => undefined);
    const inspectWorkspaceIndex = vi.fn(async () => diagnostics());
    const getWorkspaceIndexTaskStatuses = vi
      .fn()
      .mockResolvedValueOnce([
        taskStatus({ taskId: "rebuild-1", kind: "refresh-workspace", status: "running" }),
      ])
      .mockResolvedValueOnce([
        taskStatus({ taskId: "rebuild-1", kind: "refresh-workspace", status: "ready" }),
      ])
      .mockResolvedValue([
        taskStatus({ taskId: "rebuild-1", kind: "refresh-workspace", status: "ready" }),
      ]);
    const getWorkspaceIndexLayerReadiness = vi.fn(async () => layerReadiness());
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({
        rebuildWorkspaceIndex,
        inspectWorkspaceIndex,
        getWorkspaceIndexTaskStatuses,
        getWorkspaceIndexLayerReadiness,
      }),
    })));

    await act(async () => {
      await result.current.rebuildProjectIndexFromDiagnostics();
    });
    expect(result.current.workspaceIndexTaskStatuses[0]?.status).toBe("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(getWorkspaceIndexTaskStatuses).toHaveBeenCalledTimes(2);
    expect(result.current.workspaceIndexTaskStatuses[0]?.status).toBe("ready");
    expect(getWorkspaceIndexLayerReadiness).toHaveBeenCalledWith("/workspace", "/workspace/Entry.ets");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getWorkspaceIndexTaskStatuses).toHaveBeenCalledTimes(2);
  });

  it("refreshes existing layer readiness when the active file changes", async () => {
    const getWorkspaceIndexLayerReadiness = vi.fn(async (_rootPath: string, currentFilePath?: string | null) => (
      layerReadiness(currentFilePath)
    ));
    const { result, rerender } = renderHook(
      ({ activePath }) => useIndexDiagnosticsController(options({
        activePath,
        workspaceApi: workspaceApi({ getWorkspaceIndexLayerReadiness }),
      })),
      { initialProps: { activePath: "/workspace/Entry.ets" } },
    );

    await act(async () => {
      result.current.recordWorkspaceIndexTaskStatus(taskStatus({
        kind: "refresh-workspace",
        status: "ready",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });

    getWorkspaceIndexLayerReadiness.mockClear();
    await act(async () => {
      rerender({ activePath: "/workspace/Other.ets" });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getWorkspaceIndexLayerReadiness).toHaveBeenCalledWith("/workspace", "/workspace/Other.ets");
    expect(result.current.layerReadiness?.currentFilePath).toBe("/workspace/Other.ets");
  });

  it("refreshes current file readiness when diagnostics is open and active file changes", async () => {
    const getWorkspaceIndexFileReadiness = vi.fn(async (_rootPath: string, path: string) => readiness(path));
    const { result, rerender } = renderHook(
      ({ activePath }) => useIndexDiagnosticsController(options({
        activePath,
        workspaceApi: workspaceApi({ getWorkspaceIndexFileReadiness }),
      })),
      { initialProps: { activePath: "/workspace/Entry.ets" } },
    );

    await act(async () => {
      result.current.openIndexDiagnostics();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.currentFileReadiness?.path).toBe("/workspace/Entry.ets");

    await act(async () => {
      rerender({ activePath: "/workspace/Other.ets" });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getWorkspaceIndexFileReadiness).toHaveBeenLastCalledWith("/workspace", "/workspace/Other.ets");
    expect(result.current.currentFileReadiness?.path).toBe("/workspace/Other.ets");
  });

  it("clears layer readiness when the workspace is cleared", async () => {
    const getWorkspaceIndexLayerReadiness = vi.fn(async () => layerReadiness());
    const { result, rerender } = renderHook(
      ({ workspace }) => useIndexDiagnosticsController(options({
        workspace,
        workspaceApi: workspaceApi({ getWorkspaceIndexLayerReadiness }),
      })),
      { initialProps: { workspace: workspace() as WorkspaceViewModel | null } },
    );

    await act(async () => {
      result.current.recordWorkspaceIndexTaskStatus(taskStatus({
        kind: "refresh-workspace",
        status: "ready",
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.layerReadiness?.rootPath).toBe("/workspace");

    await act(async () => {
      rerender({ workspace: null });
      await Promise.resolve();
    });

    expect(result.current.layerReadiness).toBeNull();
  });
});

function options(overrides: Partial<Parameters<typeof useIndexDiagnosticsController>[0]> = {}) {
  return {
    workspaceApi: workspaceApi({}),
    workspace: workspace(),
    workspaceIndexState: indexState(),
    activePath: "/workspace/Entry.ets",
    applyWorkspaceIndexRefreshResult: vi.fn(),
    openSettings: vi.fn(async () => undefined),
    retryDefinitionQuery: vi.fn(),
    retrySearchQuery: vi.fn(),
    onStatusChange: vi.fn(),
    ...overrides,
  };
}

function waitForProjectionFlush() {
  return new Promise((resolve) => window.setTimeout(resolve, 550));
}

function indexState(): WorkspaceIndexState {
  return {
    status: "ready",
    rootPath: "/workspace",
    filePaths: ["/workspace/Entry.ets"],
    symbols: [],
    indexedAt: 1,
    partialReason: null,
    queryReadiness: null,
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

function workspace(): WorkspaceViewModel {
  return {
    rootName: "workspace",
    rootPath: "/workspace",
    visibleFiles: ["/workspace/Entry.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 1,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}

function diagnostics(): WorkspaceIndexDiagnostics {
  return {
    rootPath: "/workspace",
    status: "ready",
    schemaVersions: {},
    schemaVersionActions: [],
    fileCount: 12,
    symbolCount: 30,
    contentLineCount: 100,
    fingerprintCount: 12,
    stubFileCount: 0,
    stubDeclarationCount: 0,
    dependencyEdgeCount: 0,
    unresolvedImportCount: 0,
    parserErrorCount: 0,
    staleGenerationCount: 0,
    sdkSymbolCount: 0,
    discoveryStatus: null,
    discoveredFileCount: 0,
    discoveryExcludedCount: 0,
    discoveryHasMore: false,
    dbSizeBytes: 2048,
    queuePressure: {
      rootPath: "/workspace",
      pendingTaskCount: 0,
      workspacePendingTaskCount: 0,
      highestPriority: null,
      highestPriorityTaskKind: null,
    },
    activeSdkPath: null,
    activeSdkVersion: null,
    lastError: null,
    lastExplainStatus: null,
    repairActions: [],
    parserFailures: [],
    unresolvedImports: [],
    recentEvents: [],
    timeline: [],
  };
}

function readiness(path = "/workspace/Entry.ets"): WorkspaceIndexFileReadiness {
  return {
    rootPath: "/workspace",
    path,
    fileName: path.split("/").pop() ?? "Entry.ets",
    discoveryIndex: "ready",
    fileIndex: "ready",
    contentIndex: "ready",
    symbolIndex: "ready",
    parserStatus: "ready",
    parserError: null,
    indexedGeneration: 1,
    definitionAvailable: true,
    completionAvailable: true,
    usagesAvailable: true,
    searchAvailable: true,
    reason: "Ready",
  };
}

function layerReadiness(currentFilePath: string | null | undefined = "/workspace/Entry.ets"): WorkspaceIndexLayerReadinessReport {
  return {
    rootPath: "/workspace",
    currentFilePath: currentFilePath ?? null,
    layers: [
      {
        layer: "fileCatalog",
        workspaceStatus: "ready",
        currentFileStatus: "ready",
        indexedCount: 12,
        failedCount: 0,
        staleCount: 0,
        reason: null,
        recommendedAction: null,
      },
      {
        layer: "symbols",
        workspaceStatus: "partial",
        currentFileStatus: "missing",
        indexedCount: 8,
        failedCount: 1,
        staleCount: 3,
        reason: "Current file symbols are not ready.",
        recommendedAction: "indexCurrentFile",
      },
    ],
  };
}

function taskStatus(overrides: Partial<WorkspaceIndexTaskStatus> = {}): WorkspaceIndexTaskStatus {
  return {
    taskId: "task",
    rootPath: "/workspace",
    kind: "project-index",
    status: "ready",
    reason: "Ready",
    generation: 1,
    progressCurrent: 1,
    progressTotal: 1,
    ...overrides,
  };
}

function settings(harmonySdkPath: string): AppSettings {
  return {
    sdk: {
      harmonySdkPath,
      semanticWorkerPath: "",
      nodePath: "",
      autoDetect: true,
    },
    validation: {
      formatOnSave: false,
      lintCommand: "arklint",
      formatCommand: "arkfmt",
      timeoutMs: 5000,
    },
    editor: {
      fontSize: 13,
      fontFamily: "Menlo",
      lineHeight: 1.5,
      letterSpacing: 0,
    },
    recentProjects: [],
    workspaceSessions: {},
  };
}
