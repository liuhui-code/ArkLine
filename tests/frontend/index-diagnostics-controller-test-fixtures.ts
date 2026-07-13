import { vi } from "vitest";
import type { UseIndexDiagnosticsControllerOptions } from "@/components/layout/use-index-diagnostics-controller";
import type { AppSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-index-api-types";

export function controllerOptions(overrides: Partial<UseIndexDiagnosticsControllerOptions> = {}) {
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

export function waitForProjectionFlush() {
  return new Promise((resolve) => window.setTimeout(resolve, 550));
}

export function indexState(): WorkspaceIndexState {
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

export function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
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

export function workspace(): WorkspaceViewModel {
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

export function diagnostics(): WorkspaceIndexDiagnostics {
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
    retryBackoffCount: 0,
    latestRetryBackoff: null,
    repairActions: [],
    parserFailures: [],
    unresolvedImports: [],
    recentEvents: [],
    timeline: [],
  };
}

export function readiness(path = "/workspace/Entry.ets"): WorkspaceIndexFileReadiness {
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

export function layerReadiness(
  currentFilePath: string | null | undefined = "/workspace/Entry.ets",
): WorkspaceIndexLayerReadinessReport {
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

export function taskStatus(overrides: Partial<WorkspaceIndexTaskStatus> = {}): WorkspaceIndexTaskStatus {
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

export function settings(harmonySdkPath: string): AppSettings {
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
