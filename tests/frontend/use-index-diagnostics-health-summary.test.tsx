import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIndexDiagnosticsController } from "@/components/layout/use-index-diagnostics-controller";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type { WorkspaceApi, WorkspaceIndexDiagnostics, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexEvent, WorkspaceIndexHealth, WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-index-api-types";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

describe("useIndexDiagnosticsController health summary", () => {
  beforeEach(() => {
    workspaceIndexProjectionStore.reset();
  });

  it("surfaces retry backoff health after terminal task updates", async () => {
    const getWorkspaceIndexHealth = vi.fn(async () => health({
      retryBackoffCount: 1,
      latestRetryBackoff: "recommended retry delay 2000ms",
    }));
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({ getWorkspaceIndexHealth }),
    })));

    await act(async () => {
      result.current.recordWorkspaceIndexTaskStatus(taskStatus({
        kind: "refresh-workspace",
        status: "failed",
      }));
      await Promise.resolve();
      await Promise.resolve();
      await waitForProjectionFlush();
    });

    expect(result.current.workspaceIndexStatusSummary.workspaceIndexText)
      .toBe("Index: Backoff, recommended retry delay 2000ms");
    expect(getWorkspaceIndexHealth).toHaveBeenCalledWith("/workspace");
  });

  it("derives retry backoff status before health refresh is available", async () => {
    const { result } = renderHook(() => useIndexDiagnosticsController(options()));

    await act(async () => {
      result.current.recordWorkspaceIndexTaskStatus(taskStatus({
        taskId: "first",
        kind: "refresh-workspace",
        status: "failed",
        generation: 1,
      }));
      result.current.recordWorkspaceIndexTaskStatus(taskStatus({
        taskId: "second",
        kind: "refresh-workspace",
        status: "failed",
        generation: 2,
      }));
      await waitForProjectionFlush();
    });

    expect(result.current.workspaceIndexStatusSummary.workspaceIndexText)
      .toBe("Index: Backoff, refresh-workspace failed 2 consecutive time(s); recommended retry delay 2000ms");
  });

  it("projects backend scheduler backoff events from diagnostics refresh", async () => {
    const inspectWorkspaceIndex = vi.fn(async () => diagnostics());
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({
        inspectWorkspaceIndex,
        getWorkspaceIndexTaskStatuses: vi.fn(async () => []),
      }),
    })));

    await act(async () => {
      result.current.openIndexDiagnostics();
      await Promise.resolve();
      await waitForProjectionFlush();
    });

    expect(result.current.workspaceIndexStatusSummary.workspaceIndexText)
      .toBe("Index: Backoff, recommended retry delay 5000ms");
  });

  it("merges live query explain events into diagnostics", async () => {
    const inspectWorkspaceIndex = vi.fn(async () => diagnostics());
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({
        inspectWorkspaceIndex,
        getWorkspaceIndexTaskStatuses: vi.fn(async () => []),
      }),
    })));

    await act(async () => {
      result.current.openIndexDiagnostics();
      await Promise.resolve();
      workspaceIndexProjectionStore.recordRecentEvent("/workspace", indexEvent({
        eventId: "query-miss",
        scope: "query",
        kind: "definition",
        phase: "miss",
      }));
      await waitForProjectionFlush();
    });

    expect(result.current.indexDiagnostics?.lastExplainStatus).toBe("miss");
    expect(result.current.indexDiagnostics?.recentEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: "query-miss", scope: "query" }),
    ]));
  });
});

function waitForProjectionFlush() {
  return new Promise((resolve) => window.setTimeout(resolve, 550));
}

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

function health(overrides: Partial<WorkspaceIndexHealth> = {}): WorkspaceIndexHealth {
  return {
    rootPath: "/workspace",
    status: "healthy",
    fileCount: 12,
    symbolCount: 30,
    referenceCount: 0,
    sdkApiCount: 0,
    discoveryStatus: null,
    discoveredFileCount: 0,
    unresolvedImportCount: 0,
    parserFailureCount: 0,
    retryBackoffCount: 0,
    latestRetryBackoff: null,
    queuePressure: {
      rootPath: "/workspace",
      pendingTaskCount: 0,
      workspacePendingTaskCount: 0,
      highestPriority: null,
      highestPriorityTaskKind: null,
    },
    repairActions: [],
    ...overrides,
  };
}

function diagnostics(): WorkspaceIndexDiagnostics {
  return {
    rootPath: "/workspace",
    status: "partial",
    schemaVersions: {},
    schemaVersionActions: [],
    fileCount: 0,
    symbolCount: 0,
    contentLineCount: 0,
    fingerprintCount: 0,
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
    dbSizeBytes: 0,
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
    retryBackoffCount: 0,
    latestRetryBackoff: null,
    repairActions: [],
    parserFailures: [],
    unresolvedImports: [],
    recentEvents: [{
      eventId: "backoff",
      rootPath: "/workspace",
      scope: "scheduler",
      kind: "refresh-workspace",
      phase: "backoff",
      severity: "warning",
      message: "recommended retry delay 5000ms",
      taskId: "task",
      generation: 2,
      payloadJson: "{}",
      createdAt: 2,
    }],
    timeline: [],
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

function indexEvent(overrides: Partial<WorkspaceIndexEvent> = {}): WorkspaceIndexEvent {
  return {
    eventId: "event",
    rootPath: "/workspace",
    scope: "query",
    kind: "definition",
    phase: "miss",
    severity: "warning",
    message: "No indexed evidence explains this query yet",
    taskId: null,
    generation: null,
    payloadJson: "{}",
    createdAt: 3,
    ...overrides,
  };
}
