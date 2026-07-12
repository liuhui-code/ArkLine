import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  SDK_INDEX_READY_WAIT_ATTEMPTS,
  SDK_INDEX_READY_WAIT_INTERVAL_MS,
} from "@/components/layout/app-shell-constants";
import {
  getIndexStatusText,
  getLayerReadinessStatusText,
  getSdkIndexStatusText,
} from "@/components/layout/app-shell-model";
import type { IndexExplainContext } from "@/components/layout/app-shell-types";
import { formatIndexExplainMessage } from "@/features/workspace/index-explain-model";
import type { AppSettings } from "@/features/settings/settings-store";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type {
  WorkspaceApi,
  WorkspaceIndexDiagnostics,
  WorkspaceIndexExplainResult,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexRefreshResult,
  WorkspaceIndexTaskStatus,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

export type UseIndexDiagnosticsControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  workspaceIndexState: WorkspaceIndexState;
  activePath: string | null;
  applyWorkspaceIndexRefreshResult: (result: WorkspaceIndexRefreshResult) => void;
  openSettings: () => Promise<void>;
  retryDefinitionQuery: (selection?: { line: number; column: number }) => void;
  retrySearchQuery: (query: string) => void;
  onStatusChange: (message: string) => void;
};

export function useIndexDiagnosticsController({
  workspaceApi,
  workspace,
  workspaceIndexState,
  activePath,
  applyWorkspaceIndexRefreshResult,
  openSettings,
  retryDefinitionQuery,
  retrySearchQuery,
  onStatusChange,
}: UseIndexDiagnosticsControllerOptions) {
  const [latestExplainResult, setLatestExplainResult] = useState<WorkspaceIndexExplainResult | null>(null);
  const [latestExplainContext, setLatestExplainContext] = useState<IndexExplainContext | null>(null);
  const [indexExplainPanelVisible, setIndexExplainPanelVisible] = useState(false);
  const [indexDiagnosticsVisible, setIndexDiagnosticsVisible] = useState(false);
  const [indexDiagnosticsLoading, setIndexDiagnosticsLoading] = useState(false);
  const [indexDiagnostics, setIndexDiagnostics] = useState<WorkspaceIndexDiagnostics | null>(null);
  const [currentFileReadiness, setCurrentFileReadiness] = useState<WorkspaceIndexFileReadiness | null>(null);
  const [layerReadiness, setLayerReadiness] = useState<WorkspaceIndexLayerReadinessReport | null>(null);
  const fileReadinessRequestIdRef = useRef(0);
  const indexProjection = useSyncExternalStore(
    workspaceIndexProjectionStore.subscribe,
    workspaceIndexProjectionStore.snapshot,
    workspaceIndexProjectionStore.snapshot,
  );
  const workspaceIndexTaskStatuses = indexProjection.rootPath === workspace?.rootPath
    ? indexProjection.taskStatuses
    : [];
  const workspaceIndexStatusSummary = {
    workspaceIndexText: getLayerReadinessStatusText(layerReadiness)
      ?? getIndexStatusText(workspaceIndexState, workspaceIndexTaskStatuses),
    sdkIndexText: getSdkIndexStatusText(workspaceIndexTaskStatuses),
  };

  useEffect(() => {
    if (!workspace?.rootPath) {
      setIndexDiagnostics(null);
      setCurrentFileReadiness(null);
      setLayerReadiness(null);
      workspaceIndexProjectionStore.reset();
      return;
    }
    if (!layerReadiness) return;
    void refreshLayerReadiness();
  }, [workspace?.rootPath, activePath]);

  useEffect(() => {
    if (!indexDiagnosticsVisible) return;
    void refreshCurrentFileReadiness();
  }, [indexDiagnosticsVisible, workspace?.rootPath, activePath]);

  async function refreshWorkspaceIndexTaskStatuses(rootPath = workspace?.rootPath) {
    if (!rootPath || !workspaceApi.getWorkspaceIndexTaskStatuses) return;
    const statuses = await workspaceApi.getWorkspaceIndexTaskStatuses(rootPath);
    workspaceIndexProjectionStore.replaceTaskStatuses(rootPath, statuses);
    if (statuses.some(isTerminalProjectIndexTaskStatus)) {
      await refreshLayerReadiness(rootPath);
    }
  }

  function recordWorkspaceIndexTaskStatus(status: WorkspaceIndexTaskStatus) {
    workspaceIndexProjectionStore.recordTaskStatus(status);
    if (isTerminalIndexTaskStatus(status)) {
      void refreshLayerReadiness(status.rootPath);
    }
  }

  async function refreshLayerReadiness(rootPath = workspace?.rootPath) {
    if (!rootPath || !workspaceApi.getWorkspaceIndexLayerReadiness) return;
    try {
      const layers = await workspaceApi.getWorkspaceIndexLayerReadiness(rootPath, activePath);
      setLayerReadiness(layers);
    } catch {
      setLayerReadiness(null);
    }
  }

  async function refreshCurrentFileReadiness(rootPath = workspace?.rootPath, path = activePath) {
    const requestId = fileReadinessRequestIdRef.current + 1;
    fileReadinessRequestIdRef.current = requestId;
    if (!rootPath || !path || !workspaceApi.getWorkspaceIndexFileReadiness) {
      setCurrentFileReadiness(null);
      return;
    }
    try {
      const readiness = await workspaceApi.getWorkspaceIndexFileReadiness(rootPath, path);
      if (fileReadinessRequestIdRef.current === requestId) {
        setCurrentFileReadiness(readiness);
      }
    } catch {
      if (fileReadinessRequestIdRef.current === requestId) {
        setCurrentFileReadiness(null);
      }
    }
  }

  async function refreshIndexDiagnostics() {
    if (!workspace?.rootPath) {
      setIndexDiagnostics(null);
      setCurrentFileReadiness(null);
      setLayerReadiness(null);
      return;
    }
    setIndexDiagnosticsLoading(true);
    try {
      const [diagnostics, statuses, layers] = await Promise.all([
        workspaceApi.inspectWorkspaceIndex?.(workspace.rootPath) ?? Promise.resolve(null),
        workspaceApi.getWorkspaceIndexTaskStatuses?.(workspace.rootPath) ?? Promise.resolve([]),
        workspaceApi.getWorkspaceIndexLayerReadiness
          ? workspaceApi.getWorkspaceIndexLayerReadiness(workspace.rootPath, activePath)
          : Promise.resolve(null),
      ]);
      setIndexDiagnostics(diagnostics);
      workspaceIndexProjectionStore.replaceTaskStatuses(workspace.rootPath, statuses);
      await refreshCurrentFileReadiness(workspace.rootPath, activePath);
      setLayerReadiness(layers);
    } finally {
      setIndexDiagnosticsLoading(false);
    }
  }

  function openIndexDiagnostics() {
    setIndexDiagnosticsVisible(true);
    void refreshIndexDiagnostics();
  }

  async function resumeIndexingFromDiagnostics() {
    if (!workspace?.rootPath || !workspaceApi.resumeWorkspaceIndexing) {
      onStatusChange("Resume Indexing unavailable");
      return;
    }
    await workspaceApi.resumeWorkspaceIndexing(workspace.rootPath);
    await refreshIndexDiagnostics();
    onStatusChange("Resume Indexing requested");
  }

  async function rebuildSdkIndexFromDiagnostics() {
    if (!workspace?.rootPath || !workspaceApi.rebuildWorkspaceSdkIndex) {
      onStatusChange("Rebuild SDK Index unavailable");
      return;
    }
    const status = await workspaceApi.rebuildWorkspaceSdkIndex(workspace.rootPath);
    workspaceIndexProjectionStore.recordTaskStatus(status);
    await refreshIndexDiagnostics();
    onStatusChange("Rebuild SDK Index requested");
  }

  async function rebuildProjectIndexFromDiagnostics() {
    if (!workspace?.rootPath || !workspaceApi.rebuildWorkspaceIndex) {
      onStatusChange("Rebuild Project Index unavailable");
      return;
    }
    onStatusChange("Rebuild Project Index requested");
    await workspaceApi.rebuildWorkspaceIndex(workspace.rootPath);
    await refreshIndexDiagnostics();
  }

  async function waitForWorkspaceIndexTaskReady(rootPath: string, taskId: string) {
    if (!workspaceApi.getWorkspaceIndexTaskStatuses) return;
    for (let attempt = 0; attempt < SDK_INDEX_READY_WAIT_ATTEMPTS; attempt += 1) {
      const statuses = await workspaceApi.getWorkspaceIndexTaskStatuses(rootPath);
      const current = statuses.find((status) => status.taskId === taskId);
      if (current?.status === "ready") {
        workspaceIndexProjectionStore.replaceTaskStatuses(rootPath, statuses);
        return;
      }
      if (current?.status === "failed") {
        throw new Error(current.error ?? current.message ?? "SDK index task failed");
      }
      await new Promise((resolve) => window.setTimeout(resolve, SDK_INDEX_READY_WAIT_INTERVAL_MS));
    }
    throw new Error("SDK index task timed out");
  }

  async function indexSdkSymbolsForSettings(nextSettings: AppSettings) {
    const sdkPath = nextSettings.sdk.harmonySdkPath.trim();
    if (!workspace?.rootPath || !sdkPath) return;
    if (workspaceApi.submitWorkspaceSdkIndex) {
      onStatusChange("SDK API index queued...");
      const queued = await workspaceApi.submitWorkspaceSdkIndex(workspace.rootPath, sdkPath, "settings");
      workspaceIndexProjectionStore.recordTaskStatus(queued);
      await waitForWorkspaceIndexTaskReady(workspace.rootPath, queued.taskId);
      return;
    }
    if (!workspaceApi.indexWorkspaceSdkSymbols) return;
    onStatusChange("SDK API index updating...");
    await workspaceApi.indexWorkspaceSdkSymbols(workspace.rootPath, sdkPath, "settings");
    await refreshWorkspaceIndexTaskStatuses(workspace.rootPath);
  }

  async function explainIndexMiss(
    kind: IndexExplainContext["kind"],
    query: string,
    path?: string,
    line?: number,
    column?: number,
  ) {
    if (!workspace?.rootPath || !workspaceApi.explainWorkspaceIndexQuery) return null;
    try {
      const explain = await workspaceApi.explainWorkspaceIndexQuery({
        rootPath: workspace.rootPath,
        kind,
        query,
        path: path ?? null,
        line: line ?? null,
        column: column ?? null,
      });
      setLatestExplainResult(explain);
      setLatestExplainContext({ kind, query, path, line, column });
      return formatIndexExplainMessage(explain);
    } catch {
      return null;
    }
  }

  async function rebuildIndexFromExplainPanel() {
    if (!workspace?.rootPath || !workspaceApi.rebuildWorkspaceIndex) {
      onStatusChange("Rebuild Index unavailable");
      return;
    }
    await workspaceApi.rebuildWorkspaceIndex(workspace.rootPath);
    if (workspaceApi.refreshWorkspaceIndex) {
      const state = await workspaceApi.refreshWorkspaceIndex(workspace.rootPath);
      applyWorkspaceIndexRefreshResult({
        state,
        changed: true,
        addedPaths: state.filePaths,
        removedPaths: [],
      });
    }
    onStatusChange("Rebuild Index completed");
  }

  async function openSettingsFromExplainPanel() {
    setIndexExplainPanelVisible(false);
    await openSettings();
  }

  function retryLatestExplainQuery() {
    const context = latestExplainContext;
    setIndexExplainPanelVisible(false);
    if (!context) return;
    if (context.kind === "definition") {
      retryDefinitionQuery(context.line && context.column ? { line: context.line, column: context.column } : undefined);
      return;
    }
    if (context.kind === "search") {
      retrySearchQuery(context.query);
      return;
    }
    onStatusChange(`Retry Query: ${context.query}`);
  }

  return {
    latestExplainResult,
    latestExplainContext,
    indexExplainPanelVisible,
    setIndexExplainPanelVisible,
    indexDiagnosticsVisible,
    setIndexDiagnosticsVisible,
    indexDiagnosticsLoading,
    indexDiagnostics,
    currentFileReadiness,
    layerReadiness,
    workspaceIndexTaskStatuses,
    workspaceIndexStatusSummary,
    recordWorkspaceIndexTaskStatus,
    refreshWorkspaceIndexTaskStatuses,
    refreshIndexDiagnostics,
    openIndexDiagnostics,
    resumeIndexingFromDiagnostics,
    rebuildProjectIndexFromDiagnostics,
    rebuildSdkIndexFromDiagnostics,
    indexSdkSymbolsForSettings,
    explainIndexMiss,
    rebuildIndexFromExplainPanel,
    openSettingsFromExplainPanel,
    retryLatestExplainQuery,
  };
}

function isTerminalIndexTaskStatus(status: WorkspaceIndexTaskStatus) {
  return status.status === "ready"
    || status.status === "partial"
    || status.status === "stale"
    || status.status === "failed";
}

function isTerminalProjectIndexTaskStatus(status: WorkspaceIndexTaskStatus) {
  return status.kind !== "sdk" && isTerminalIndexTaskStatus(status);
}
