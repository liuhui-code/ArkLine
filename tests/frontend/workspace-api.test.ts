import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";
const eventListeners = vi.hoisted(() => [] as Array<(event: { payload: unknown }) => void>);
const unlisten = vi.hoisted(() => vi.fn());
const invoke = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));

function deviceLogQueryRequest(streamId: string, query = "") {
  return {
    streamId,
    query,
    regex: false,
    matchCase: false,
    levels: [],
    pid: "",
    process: "",
    domain: "",
    tag: "",
    timeRangeMs: 60_000,
    limit: 500,
    cursorSeq: null,
    scanBudgetLines: 100_000,
  };
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_eventName: string, callback: (event: { payload: unknown }) => void) => {
    eventListeners.push(callback);
    return unlisten;
  }),
}));

describe("workspace api", () => {
  beforeEach(() => {
    eventListeners.length = 0;
    invoke.mockClear();
    unlisten.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("subscribes to workspace index events and forwards only the active root", async () => {
    const onChange = vi.fn();

    const teardown = await defaultWorkspaceApi.watchWorkspaceIndex?.("C:/samples/DemoWorkspace", onChange);

    expect(invoke).toHaveBeenCalledWith("watch_workspace_index", { rootPath: "C:/samples/DemoWorkspace" });
    expect(eventListeners).toHaveLength(1);
    eventListeners[0]?.({
      payload: {
        state: {
          status: "ready",
          rootPath: "C:/samples/OtherWorkspace",
          filePaths: [],
          indexedAt: 1,
          partialReason: null,
        },
        changed: true,
        addedPaths: ["C:/samples/OtherWorkspace/src/Other.ets"],
        removedPaths: [],
      },
    });
    eventListeners[0]?.({
      payload: {
        state: {
          status: "ready",
          rootPath: "C:\\samples\\DemoWorkspace",
          filePaths: ["C:\\samples\\DemoWorkspace\\src\\About.ets"],
          indexedAt: 2,
          partialReason: null,
        },
        changed: true,
        addedPaths: ["C:\\samples\\DemoWorkspace\\src\\About.ets"],
        removedPaths: [],
      },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      addedPaths: ["C:\\samples\\DemoWorkspace\\src\\About.ets"],
    }));

    teardown?.();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("unwatch_workspace_index", { rootPath: "C:/samples/DemoWorkspace" });
  });

  it("returns complete fallback diagnostics outside the desktop runtime", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const diagnostics = await defaultWorkspaceApi.inspectWorkspaceIndex?.("C:/samples/DemoWorkspace");

    expect(diagnostics).toMatchObject({
      stubFileCount: 0,
      stubDeclarationCount: 0,
      dependencyEdgeCount: 0,
      unresolvedImportCount: 0,
      parserErrorCount: 0,
      staleGenerationCount: 0,
      discoveryStatus: null,
      discoveredFileCount: 0,
      discoveryExcludedCount: 0,
      discoveryHasMore: false,
      dbSizeBytes: 0,
      queuePressure: emptyQueuePressure("C:/samples/DemoWorkspace"),
      lastError: null,
      lastExplainStatus: null,
      retryBackoffCount: 0,
      latestRetryBackoff: null,
      repairActions: [],
      parserFailures: [],
      unresolvedImports: [],
      recentEvents: [],
    });
  });

  it("queries device logs through the workspace API contract outside Tauri", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const response = await defaultWorkspaceApi.queryDeviceLogs?.(deviceLogQueryRequest("demo-device-log-stream", "width"));

    expect(response?.rows).toEqual([]);
    expect(response?.truncated).toBe(false);
  });

  it("invokes desktop device log query and stats commands inside Tauri", async () => {
    invoke
      .mockResolvedValueOnce({ rows: [], totalCandidates: 0, scannedLines: 0, truncated: false, nextCursorSeq: null, budgetExceeded: false, queryMs: 1 })
      .mockResolvedValueOnce("raw log\n")
      .mockResolvedValueOnce({
        streamId: "stream-1",
        deviceId: "device-1",
        streamStatus: "running",
        ingestedLines: 10,
        persistedLines: 10,
        droppedLines: 0,
        pendingBatches: 0,
        bufferBytes: 128,
        lastWriteMs: 0,
        slowWriteBatches: 0,
        backpressureState: "idle",
        lastError: null,
      })
      .mockResolvedValueOnce({ rootPath: "/tmp/arkline-device-logs", totalBytes: 4096, segmentFileCount: 1, segmentBytes: 2048, metadataBytes: 2048, metadataBatchCount: 2, metadataLineCount: 120, oldestReceivedAtMs: 10_000, newestReceivedAtMs: 20_000, pressureState: "healthy", recommendedAction: "none" });

    await defaultWorkspaceApi.queryDeviceLogs?.(deviceLogQueryRequest("stream-1"));
    await defaultWorkspaceApi.exportDeviceLogs?.(deviceLogQueryRequest("stream-1"));
    await defaultWorkspaceApi.getDeviceLogStats?.("stream-1");
    const health = await defaultWorkspaceApi.getDeviceLogStorageHealth?.();

    expect(invoke).toHaveBeenCalledWith("query_device_logs", {
      request: expect.objectContaining({ streamId: "stream-1", timeRangeMs: 60_000 }),
    });
    expect(invoke).toHaveBeenCalledWith("export_device_logs", {
      request: expect.objectContaining({ streamId: "stream-1", timeRangeMs: 60_000 }),
    });
    expect(invoke).toHaveBeenCalledWith("get_device_log_stats", { streamId: "stream-1" });
    expect(invoke).toHaveBeenCalledWith("get_device_log_storage_health", undefined);
    expect(health?.segmentFileCount).toBe(1);
  });

  it("invokes workspace index diagnostics with recent events in the desktop runtime", async () => {
    const diagnostics = {
      rootPath: "C:/samples/DemoWorkspace",
      status: "ready",
      schemaVersions: { event: 1 },
      schemaVersionActions: [],
    freshnessLayers: [],
      fileCount: 1,
      symbolCount: 1,
      contentLineCount: 1,
      fingerprintCount: 1,
      stubFileCount: 1,
      stubDeclarationCount: 1,
      dependencyEdgeCount: 0,
      unresolvedImportCount: 0,
      parserErrorCount: 0,
      staleGenerationCount: 0,
      sdkSymbolCount: 0,
      discoveryStatus: null,
      discoveredFileCount: 0,
      discoveryExcludedCount: 0,
      discoveryHasMore: false,
      dbSizeBytes: 4096,
      queuePressure: {
        ...emptyQueuePressure("C:/samples/DemoWorkspace"),
        pendingTaskCount: 1,
        workspacePendingTaskCount: 1,
        highestPriority: "foreground",
        highestPriorityTaskKind: "foreground-navigation",
      },
      activeSdkPath: null,
      activeSdkVersion: null,
      lastError: null,
      lastExplainStatus: null,
      retryBackoffCount: 0,
      latestRetryBackoff: null,
      repairActions: ["resumeIndexing"],
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
        eventId: "1:refresh-workspace:queued:100",
        rootPath: "C:/samples/DemoWorkspace",
        scope: "task",
        kind: "refresh-workspace",
        phase: "queued",
        severity: "info",
        message: "refresh-workspace queued",
        taskId: "1:refresh-workspace",
        generation: 1,
        payloadJson: "{}",
        createdAt: 100,
      }],
      timeline: [{
        scope: "task",
        kind: "refresh-workspace",
        phase: "queued",
        title: "refresh-workspace queued",
        severity: "info",
        message: "refresh-workspace queued",
        taskId: "1:refresh-workspace",
        generation: 1,
        occurredAt: 100,
        durationMs: null,
      }],
    };
    invoke.mockResolvedValueOnce(diagnostics);

    await expect(defaultWorkspaceApi.inspectWorkspaceIndex?.("C:/samples/DemoWorkspace")).resolves.toEqual(diagnostics);
    expect(invoke).toHaveBeenCalledWith("inspect_workspace_index", { rootPath: "C:/samples/DemoWorkspace" });
  });

  it("invokes current file index readiness in the desktop runtime", async () => {
    const readiness = {
      rootPath: "C:/samples/DemoWorkspace",
      path: "C:/samples/DemoWorkspace/src/main.ets",
      fileName: "main.ets",
      discoveryIndex: "ready",
      fileIndex: "ready",
      contentIndex: "ready",
      symbolIndex: "missing",
      parserStatus: "ready",
      parserError: null,
      indexedGeneration: 18,
      definitionAvailable: false,
      completionAvailable: true,
      usagesAvailable: false,
      searchAvailable: true,
      reason: "main.ets is in the file index but symbol data is not ready yet.",
    };
    invoke.mockResolvedValueOnce(readiness);

    await expect(defaultWorkspaceApi.getWorkspaceIndexFileReadiness?.(
      "C:/samples/DemoWorkspace",
      "C:/samples/DemoWorkspace/src/main.ets",
    )).resolves.toEqual(readiness);
    expect(invoke).toHaveBeenCalledWith("get_workspace_index_file_readiness", {
      rootPath: "C:/samples/DemoWorkspace",
      filePath: "C:/samples/DemoWorkspace/src/main.ets",
    });
  });

  it("invokes workspace index layer readiness in the desktop runtime", async () => {
    const layerReport = {
      rootPath: "C:/samples/DemoWorkspace",
      currentFilePath: "C:/samples/DemoWorkspace/src/main.ets",
      layers: [{
        layer: "fileCatalog",
        workspaceStatus: "ready",
        currentFileStatus: "ready",
        indexedCount: 12,
        failedCount: 0,
        staleCount: 0,
        reason: null,
        recommendedAction: null,
      }],
    };
    invoke.mockResolvedValueOnce(layerReport);

    await expect(defaultWorkspaceApi.getWorkspaceIndexLayerReadiness?.(
      "C:/samples/DemoWorkspace",
      "C:/samples/DemoWorkspace/src/main.ets",
    )).resolves.toEqual(layerReport);
    expect(invoke).toHaveBeenCalledWith("get_workspace_index_layer_readiness", {
      rootPath: "C:/samples/DemoWorkspace",
      currentFilePath: "C:/samples/DemoWorkspace/src/main.ets",
    });
  });

  it("returns fallback layer readiness outside the desktop runtime", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const report = await defaultWorkspaceApi.getWorkspaceIndexLayerReadiness?.("C:/samples/DemoWorkspace", null);

    expect(report).toMatchObject({
      rootPath: "C:/samples/DemoWorkspace",
      currentFilePath: null,
    });
    expect(report?.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: "discovery", workspaceStatus: "missing" }),
      expect.objectContaining({ layer: "fileCatalog", workspaceStatus: "missing" }),
      expect.objectContaining({ layer: "sdk", workspaceStatus: "missing" }),
    ]));
  });

  it("returns fallback index health outside the desktop runtime", async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const health = await defaultWorkspaceApi.getWorkspaceIndexHealth?.("C:/samples/DemoWorkspace");

    expect(health).toMatchObject({
      rootPath: "C:/samples/DemoWorkspace",
      status: "stale",
      queuePressure: {
        pendingTaskCount: 0,
        workspacePendingTaskCount: 0,
      },
      retryBackoffCount: 0,
      latestRetryBackoff: null,
      repairActions: ["rebuildProjectIndex"],
    });
  });

  it("invokes workspace index health in the desktop runtime", async () => {
    const health = {
      rootPath: "C:/samples/DemoWorkspace",
      status: "healthy",
      fileCount: 1,
      symbolCount: 1,
      referenceCount: 1,
      sdkApiCount: 1,
      discoveryStatus: "ready",
      discoveredFileCount: 1,
      unresolvedImportCount: 0,
      parserFailureCount: 0,
      retryBackoffCount: 0,
      latestRetryBackoff: null,
      queuePressure: emptyQueuePressure("C:/samples/DemoWorkspace"),
      repairActions: [],
    };
    invoke.mockResolvedValueOnce(health);

    await expect(defaultWorkspaceApi.getWorkspaceIndexHealth?.("C:/samples/DemoWorkspace")).resolves.toEqual(health);
    expect(invoke).toHaveBeenCalledWith("get_workspace_index_health", { rootPath: "C:/samples/DemoWorkspace" });
  });

  it("invokes resume workspace indexing in the desktop runtime", async () => {
    await defaultWorkspaceApi.resumeWorkspaceIndexing?.("C:/samples/DemoWorkspace");

    expect(invoke).toHaveBeenCalledWith("resume_workspace_indexing", {
      rootPath: "C:/samples/DemoWorkspace",
    });
  });

  it("invokes rebuild workspace sdk index in the desktop runtime", async () => {
    const status = {
      taskId: "1:sdk",
      rootPath: "C:/samples/DemoWorkspace",
      kind: "sdk",
      status: "queued",
      reason: "sdk-apply",
      generation: 1,
      progressCurrent: 0,
      progressTotal: 1,
      startedAt: null,
      finishedAt: null,
      symbolCount: null,
      message: null,
      error: null,
    };
    invoke.mockResolvedValueOnce(status);

    await expect(defaultWorkspaceApi.rebuildWorkspaceSdkIndex?.("C:/samples/DemoWorkspace")).resolves.toEqual(status);

    expect(invoke).toHaveBeenCalledWith("rebuild_workspace_sdk_index", {
      rootPath: "C:/samples/DemoWorkspace",
    });
  });

  it("invokes parser failure inspection in the desktop runtime", async () => {
    const failures = [{ path: "src/Broken.ets", message: "Unclosed block", line: 1, column: 1 }];
    invoke.mockResolvedValueOnce(failures);

    await expect(defaultWorkspaceApi.inspectWorkspaceParserFailures?.("C:/samples/DemoWorkspace", 20)).resolves.toEqual(failures);

    expect(invoke).toHaveBeenCalledWith("inspect_workspace_parser_failures", {
      rootPath: "C:/samples/DemoWorkspace",
      limit: 20,
    });
  });

  it("invokes unresolved import inspection in the desktop runtime", async () => {
    const imports = [{ fromPath: "src/Index.ets", sourceModule: "./Missing", line: 1, column: 8 }];
    invoke.mockResolvedValueOnce(imports);

    await expect(defaultWorkspaceApi.inspectWorkspaceUnresolvedImports?.("C:/samples/DemoWorkspace", 20)).resolves.toEqual(imports);

    expect(invoke).toHaveBeenCalledWith("inspect_workspace_unresolved_imports", {
      rootPath: "C:/samples/DemoWorkspace",
      limit: 20,
    });
  });

});

function emptyQueuePressure(rootPath: string) {
  return { rootPath,
    pendingTaskCount: 0,
    workspacePendingTaskCount: 0,
    highestPriority: null,
    highestPriorityTaskKind: null,
  };
}
