import type { Event as TauriEvent } from "@tauri-apps/api/event";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexHealth,
  WorkspaceIndexLayerReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexParserFailure,
  WorkspaceIndexTaskStatus,
  WorkspaceIndexTaskStatusWatcher,
  WorkspaceIndexUnresolvedImport,
  WorkspaceSdkIndexSummary,
} from "@/features/workspace/workspace-index-api-types";
import type {
  WorkspaceIndexRefreshResult,
  WorkspaceIndexWatcher,
} from "@/features/workspace/workspace-api-contract";

type InvokeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type ListenCommand = <T>(
  event: string,
  handler: (event: TauriEvent<T>) => void,
) => Promise<() => void>;

type WorkspaceIndexManagementApiDependencies = {
  invoke: InvokeCommand;
  listen: ListenCommand;
  hasTauriRuntime: () => boolean;
  normalizePath: (path: string) => string;
  getPathBasename: (path: string) => string;
};

export type WorkspaceIndexManagementApi = {
  getWorkspaceIndexState(rootPath: string): Promise<WorkspaceIndexState>;
  inspectWorkspaceIndex(rootPath: string): Promise<WorkspaceIndexDiagnostics>;
  getWorkspaceIndexHealth(rootPath: string): Promise<WorkspaceIndexHealth>;
  getWorkspaceIndexFileReadiness(rootPath: string, filePath: string): Promise<WorkspaceIndexFileReadiness>;
  getWorkspaceIndexLayerReadiness(rootPath: string, currentFilePath?: string | null): Promise<WorkspaceIndexLayerReadinessReport>;
  getWorkspaceIndexTaskStatuses(rootPath: string): Promise<WorkspaceIndexTaskStatus[]>;
  watchWorkspaceIndexTaskStatuses(rootPath: string, onChange: WorkspaceIndexTaskStatusWatcher): Promise<() => void>;
  clearWorkspaceIndex(rootPath: string): Promise<void>;
  rebuildWorkspaceIndex(rootPath: string): Promise<void>;
  resumeWorkspaceIndexing(rootPath: string): Promise<void>;
  rebuildWorkspaceSdkIndex(rootPath: string): Promise<WorkspaceIndexTaskStatus>;
  inspectWorkspaceParserFailures(rootPath: string, limit: number): Promise<WorkspaceIndexParserFailure[]>;
  inspectWorkspaceUnresolvedImports(rootPath: string, limit: number): Promise<WorkspaceIndexUnresolvedImport[]>;
  indexWorkspaceSdkSymbols(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceSdkIndexSummary>;
  submitWorkspaceSdkIndex(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceIndexTaskStatus>;
  updateWorkspaceIndexFiles(rootPath: string, addedPaths: string[], removedPaths: string[]): Promise<WorkspaceIndexState>;
  scheduleForegroundCompletionIndex(rootPath: string, changedPaths: string[]): Promise<void>;
  scheduleForegroundNavigationIndex(rootPath: string, changedPaths: string[]): Promise<void>;
  scheduleVisibleFilesIndex(rootPath: string, changedPaths: string[]): Promise<void>;
  refreshWorkspaceIndex(rootPath: string): Promise<WorkspaceIndexState>;
  refreshWorkspaceIndexWithChanges(rootPath: string): Promise<WorkspaceIndexRefreshResult>;
  watchWorkspaceIndex(rootPath: string, onChange: WorkspaceIndexWatcher): Promise<() => void>;
};

export function createWorkspaceIndexManagementApi(deps: WorkspaceIndexManagementApiDependencies): WorkspaceIndexManagementApi {
  return {
    getWorkspaceIndexState: (rootPath) => getWorkspaceIndexState(deps, rootPath),
    inspectWorkspaceIndex: (rootPath) => inspectWorkspaceIndex(deps, rootPath),
    getWorkspaceIndexHealth: (rootPath) => getWorkspaceIndexHealth(deps, rootPath),
    getWorkspaceIndexFileReadiness: (rootPath, filePath) => getWorkspaceIndexFileReadiness(deps, rootPath, filePath),
    getWorkspaceIndexLayerReadiness: (rootPath, currentFilePath = null) => getWorkspaceIndexLayerReadiness(deps, rootPath, currentFilePath),
    getWorkspaceIndexTaskStatuses: (rootPath) => getWorkspaceIndexTaskStatuses(deps, rootPath),
    watchWorkspaceIndexTaskStatuses: (rootPath, onChange) => watchWorkspaceIndexTaskStatuses(deps, rootPath, onChange),
    clearWorkspaceIndex: (rootPath) => invokeVoid(deps, "clear_workspace_index", { rootPath }),
    rebuildWorkspaceIndex: (rootPath) => invokeVoid(deps, "rebuild_workspace_index", { rootPath }),
    resumeWorkspaceIndexing: (rootPath) => invokeVoid(deps, "resume_workspace_indexing", { rootPath }),
    rebuildWorkspaceSdkIndex: (rootPath) => rebuildWorkspaceSdkIndex(deps, rootPath),
    inspectWorkspaceParserFailures: (rootPath, limit) => inspectWorkspaceParserFailures(deps, rootPath, limit),
    inspectWorkspaceUnresolvedImports: (rootPath, limit) => inspectWorkspaceUnresolvedImports(deps, rootPath, limit),
    indexWorkspaceSdkSymbols: (rootPath, sdkPath, sdkVersion) => indexWorkspaceSdkSymbols(deps, rootPath, sdkPath, sdkVersion),
    submitWorkspaceSdkIndex: (rootPath, sdkPath, sdkVersion) => submitWorkspaceSdkIndex(deps, rootPath, sdkPath, sdkVersion),
    updateWorkspaceIndexFiles: (rootPath, addedPaths, removedPaths) => updateWorkspaceIndexFiles(deps, rootPath, addedPaths, removedPaths),
    scheduleForegroundCompletionIndex: (rootPath, changedPaths) => invokeVoid(deps, "schedule_foreground_completion_index", { rootPath, changedPaths }),
    scheduleForegroundNavigationIndex: (rootPath, changedPaths) => invokeVoid(deps, "schedule_foreground_navigation_index", { rootPath, changedPaths }),
    scheduleVisibleFilesIndex: (rootPath, changedPaths) => invokeVoid(deps, "schedule_visible_files_index", { rootPath, changedPaths }),
    refreshWorkspaceIndex: (rootPath) => refreshWorkspaceIndex(deps, rootPath),
    refreshWorkspaceIndexWithChanges: (rootPath) => refreshWorkspaceIndexWithChanges(deps, rootPath),
    watchWorkspaceIndex: (rootPath, onChange) => watchWorkspaceIndex(deps, rootPath, onChange),
  };
}

async function getWorkspaceIndexState(deps: WorkspaceIndexManagementApiDependencies, rootPath: string) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexState>("get_workspace_index_state", { rootPath });
  }
  void rootPath;
  return emptyIndexState();
}

async function inspectWorkspaceIndex(deps: WorkspaceIndexManagementApiDependencies, rootPath: string) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexDiagnostics>("inspect_workspace_index", { rootPath });
  }
  return {
    rootPath,
    status: "empty",
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
    queuePressure: emptyQueuePressure(rootPath),
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

async function getWorkspaceIndexHealth(deps: WorkspaceIndexManagementApiDependencies, rootPath: string) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexHealth>("get_workspace_index_health", { rootPath });
  }
  return {
    rootPath,
    status: "stale",
    fileCount: 0,
    symbolCount: 0,
    referenceCount: 0,
    sdkApiCount: 0,
    discoveryStatus: null,
    discoveredFileCount: 0,
    unresolvedImportCount: 0,
    parserFailureCount: 0,
    queuePressure: emptyQueuePressure(rootPath),
    repairActions: ["rebuildProjectIndex"],
  };
}

async function getWorkspaceIndexFileReadiness(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  filePath: string,
) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexFileReadiness>("get_workspace_index_file_readiness", { rootPath, filePath });
  }
  const fileName = deps.getPathBasename(filePath);
  return {
    rootPath,
    path: filePath,
    fileName,
    discoveryIndex: "missing",
    fileIndex: "missing",
    contentIndex: "missing",
    symbolIndex: "missing",
    parserStatus: "unknown",
    parserError: null,
    indexedGeneration: null,
    definitionAvailable: false,
    completionAvailable: false,
    usagesAvailable: false,
    searchAvailable: true,
    reason: `${fileName} is not indexed outside the desktop runtime.`,
  };
}

async function getWorkspaceIndexLayerReadiness(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  currentFilePath: string | null,
) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexLayerReadinessReport>("get_workspace_index_layer_readiness", {
      rootPath,
      currentFilePath,
    });
  }
  return emptyLayerReadiness(rootPath, currentFilePath);
}

async function getWorkspaceIndexTaskStatuses(deps: WorkspaceIndexManagementApiDependencies, rootPath: string) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexTaskStatus[]>("get_workspace_index_task_statuses", { rootPath });
  }
  void rootPath;
  return [];
}

async function watchWorkspaceIndexTaskStatuses(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  onChange: WorkspaceIndexTaskStatusWatcher,
) {
  if (!deps.hasTauriRuntime()) {
    return () => undefined;
  }

  const unlisten = await deps.listen<WorkspaceIndexTaskStatus>("workspace-index-task-updated", (event) => {
    if (deps.normalizePath(event.payload.rootPath) !== deps.normalizePath(rootPath)) {
      return;
    }
    onChange(event.payload);
  });

  return () => {
    unlisten();
  };
}

async function rebuildWorkspaceSdkIndex(deps: WorkspaceIndexManagementApiDependencies, rootPath: string) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexTaskStatus>("rebuild_workspace_sdk_index", { rootPath });
  }
  void rootPath;
  return readySdkTaskStatus();
}

async function inspectWorkspaceParserFailures(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  limit: number,
) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexParserFailure[]>("inspect_workspace_parser_failures", { rootPath, limit });
  }
  void rootPath;
  void limit;
  return [];
}

async function inspectWorkspaceUnresolvedImports(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  limit: number,
) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexUnresolvedImport[]>("inspect_workspace_unresolved_imports", { rootPath, limit });
  }
  void rootPath;
  void limit;
  return [];
}

async function indexWorkspaceSdkSymbols(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  sdkPath: string,
  sdkVersion: string,
) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceSdkIndexSummary>("index_workspace_sdk_symbols", { rootPath, sdkPath, sdkVersion });
  }
  void rootPath;
  void sdkPath;
  void sdkVersion;
  return { symbolCount: 0 };
}

async function submitWorkspaceSdkIndex(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  sdkPath: string,
  sdkVersion: string,
) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexTaskStatus>("submit_workspace_sdk_index", { rootPath, sdkPath, sdkVersion });
  }
  void rootPath;
  void sdkPath;
  void sdkVersion;
  return readySdkTaskStatus();
}

async function updateWorkspaceIndexFiles(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  addedPaths: string[],
  removedPaths: string[],
) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexState>("update_workspace_index_files", { rootPath, addedPaths, removedPaths });
  }
  void rootPath;
  void addedPaths;
  void removedPaths;
  return emptyIndexState();
}

async function refreshWorkspaceIndex(deps: WorkspaceIndexManagementApiDependencies, rootPath: string) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexState>("refresh_workspace_index", { rootPath });
  }
  void rootPath;
  return emptyIndexState();
}

async function refreshWorkspaceIndexWithChanges(deps: WorkspaceIndexManagementApiDependencies, rootPath: string) {
  if (deps.hasTauriRuntime()) {
    return deps.invoke<WorkspaceIndexRefreshResult>("refresh_workspace_index_with_changes", { rootPath });
  }
  void rootPath;
  return {
    state: emptyIndexState(),
    changed: false,
    addedPaths: [],
    removedPaths: [],
  };
}

async function watchWorkspaceIndex(
  deps: WorkspaceIndexManagementApiDependencies,
  rootPath: string,
  onChange: WorkspaceIndexWatcher,
) {
  if (!deps.hasTauriRuntime()) {
    return () => undefined;
  }

  const unlisten = await deps.listen<WorkspaceIndexRefreshResult>("workspace-index-changed", (event) => {
    const eventRootPath = event.payload.state.rootPath;
    if (eventRootPath && deps.normalizePath(eventRootPath) !== deps.normalizePath(rootPath)) {
      return;
    }
    onChange(event.payload);
  });

  try {
    await deps.invoke("watch_workspace_index", { rootPath });
  } catch (error) {
    unlisten();
    throw error;
  }

  return () => {
    unlisten();
    void deps.invoke("unwatch_workspace_index", { rootPath });
  };
}

async function invokeVoid(
  deps: WorkspaceIndexManagementApiDependencies,
  command: string,
  args: Record<string, unknown>,
) {
  if (deps.hasTauriRuntime()) {
    await deps.invoke(command, args);
  }
}

function emptyQueuePressure(rootPath: string) {
  return {
    rootPath,
    pendingTaskCount: 0,
    workspacePendingTaskCount: 0,
    highestPriority: null,
    highestPriorityTaskKind: null,
  };
}

function emptyIndexState(): WorkspaceIndexState {
  return {
    status: "empty",
    rootPath: null,
    filePaths: [],
    symbols: [],
    indexedAt: null,
    partialReason: null,
  };
}

function emptyLayerReadiness(rootPath: string, currentFilePath: string | null): WorkspaceIndexLayerReadinessReport {
  return {
    rootPath,
    currentFilePath,
    layers: [
      emptyLayer("discovery"),
      emptyLayer("fileCatalog"),
      emptyLayer("fingerprint"),
      emptyLayer("content"),
      emptyLayer("stub"),
      emptyLayer("symbols"),
      emptyLayer("references"),
      emptyLayer("dependencyGraph"),
      emptyLayer("sdk"),
    ],
  };
}

function emptyLayer(layer: string): WorkspaceIndexLayerReadiness {
  return {
    layer,
    workspaceStatus: "missing",
    currentFileStatus: null,
    indexedCount: 0,
    failedCount: 0,
    staleCount: 0,
    reason: `${layer} index is unavailable outside the desktop runtime.`,
    recommendedAction: layer === "sdk" ? "configureSdk" : "openWorkspace",
  };
}

function readySdkTaskStatus(): WorkspaceIndexTaskStatus {
  return {
    taskId: "local:sdk",
    rootPath: "",
    kind: "sdk",
    status: "ready",
    reason: "local-fallback",
    generation: 0,
    progressCurrent: 1,
    progressTotal: 1,
    startedAt: undefined,
    finishedAt: undefined,
    symbolCount: 0,
    message: undefined,
    error: undefined,
  };
}
