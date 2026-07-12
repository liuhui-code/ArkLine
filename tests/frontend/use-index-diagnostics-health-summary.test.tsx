import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIndexDiagnosticsController } from "@/components/layout/use-index-diagnostics-controller";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexHealth, WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-index-api-types";
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
