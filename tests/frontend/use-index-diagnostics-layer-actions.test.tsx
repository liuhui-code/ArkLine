import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIndexDiagnosticsController } from "@/components/layout/use-index-diagnostics-controller";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

describe("useIndexDiagnosticsController layer actions", () => {
  it("schedules foreground navigation indexing for the active file", async () => {
    const scheduleForegroundNavigationIndex = vi.fn(async () => undefined);
    const inspectWorkspaceIndex = vi.fn(async () => diagnostics());
    const getWorkspaceIndexTaskStatuses = vi.fn(async () => []);
    const getWorkspaceIndexLayerReadiness = vi.fn(async () => layerReadiness());
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useIndexDiagnosticsController(options({
      workspaceApi: workspaceApi({
        scheduleForegroundNavigationIndex,
        inspectWorkspaceIndex,
        getWorkspaceIndexTaskStatuses,
        getWorkspaceIndexLayerReadiness,
      }),
      onStatusChange,
    })));

    await act(async () => {
      await result.current.indexCurrentFileFromDiagnostics();
    });

    expect(scheduleForegroundNavigationIndex).toHaveBeenCalledWith("/workspace", ["/workspace/Entry.ets"]);
    expect(inspectWorkspaceIndex).toHaveBeenCalledWith("/workspace");
    expect(onStatusChange).toHaveBeenCalledWith("Index Current File requested");
  });
});

function options(overrides: Partial<Parameters<typeof useIndexDiagnosticsController>[0]> = {}) {
  return {
    workspaceApi: workspaceApi(),
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

function workspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    openWorkspace: vi.fn(),
    readFile: vi.fn(),
    listDirectory: vi.fn(),
    scanWorkspace: vi.fn(),
    updateWorkspaceIndexFiles: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceApi;
}

function workspace(): WorkspaceViewModel {
  return {
    rootPath: "/workspace",
    rootName: "workspace",
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
    filePaths: [],
    symbols: [],
    indexedAt: 1,
    partialReason: null,
    queryReadiness: null,
  };
}

function diagnostics() {
  return {
    rootPath: "/workspace",
    status: "ready",
    schemaVersions: {},
    schemaVersionActions: [],
    fileCount: 1,
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
    repairActions: [],
    parserFailures: [],
    unresolvedImports: [],
    recentEvents: [],
    timeline: [],
  };
}

function layerReadiness() {
  return {
    rootPath: "/workspace",
    currentFilePath: "/workspace/Entry.ets",
    layers: [],
  };
}
