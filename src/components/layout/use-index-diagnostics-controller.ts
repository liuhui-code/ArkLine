import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  SDK_INDEX_READY_WAIT_ATTEMPTS,
  SDK_INDEX_READY_WAIT_INTERVAL_MS,
} from "@/components/layout/app-shell-constants";
import {
  isTerminalIndexTaskStatus,
  isTerminalProjectIndexTaskStatus,
  mergeIndexDiagnosticsProjection,
  workspaceIndexStatusSummary as buildWorkspaceIndexStatusSummary,
} from "@/components/layout/index-diagnostics-controller-model";
import type { IndexExplainContext } from "@/components/layout/app-shell-types";
import { formatIndexExplainMessage } from "@/features/workspace/index-explain-model";
import type { AppSettings } from "@/features/settings/settings-store";
import {
  workspaceIndexProjectionStore,
  type WorkspaceIndexProjectionSnapshot,
} from "@/features/workspace/workspace-index-projection-store";
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
import { workspaceIndexTaskPublicationFallbackKey } from "@/features/workspace/workspace-index-query-publication";

const DIAGNOSTICS_REBUILD_POLL_INTERVAL_MS = 1_000;

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
  const [indexDiagnosticsSectionTarget, setIndexDiagnosticsSectionTarget] = useState<string | null>(null);
  const [indexDiagnosticsLoading, setIndexDiagnosticsLoading] = useState(false);
  const [indexDiagnostics, setIndexDiagnostics] = useState<WorkspaceIndexDiagnostics | null>(null);
  const [diagnosticsProjection, setDiagnosticsProjection] = useState<WorkspaceIndexProjectionSnapshot | null>(null);
  const [currentFileReadiness, setCurrentFileReadiness] = useState<WorkspaceIndexFileReadiness | null>(null);
  const [layerReadiness, setLayerReadiness] = useState<WorkspaceIndexLayerReadinessReport | null>(null);
  const [taskPublicationFallbackKey, setTaskPublicationFallbackKey] = useState("");
  const fileReadinessRequestIdRef = useRef(0);
  const layerReadinessRequestIdRef = useRef(0);
  const workspaceRootPathRef = useRef(workspace?.rootPath ?? null);
  workspaceRootPathRef.current = workspace?.rootPath ?? null;
  const diagnosticsRebuildPollRef = useRef<number | null>(null);
  const indexProjection = useSyncExternalStore(
    workspaceIndexProjectionStore.subscribeStatus,
    workspaceIndexProjectionStore.statusSnapshot,
    workspaceIndexProjectionStore.statusSnapshot,
  );
  const statusTaskStatuses = indexProjection.rootPath === workspace?.rootPath
    ? indexProjection.taskStatuses
    : [];
  const activeDiagnosticsProjection = diagnosticsProjection
    && diagnosticsProjection.rootPath === workspace?.rootPath
    ? diagnosticsProjection
    : null;
  const workspaceIndexTaskStatuses = activeDiagnosticsProjection
    ? activeDiagnosticsProjection.taskStatuses
    : statusTaskStatuses;
  const indexHealthSummary = indexProjection.rootPath === workspace?.rootPath
    ? indexProjection.healthSummary
    : null;
  const effectiveIndexDiagnostics = mergeIndexDiagnosticsProjection(
    indexDiagnostics,
    activeDiagnosticsProjection,
  );
  const workspaceIndexStatusSummary = buildWorkspaceIndexStatusSummary({
    diagnostics: effectiveIndexDiagnostics,
    healthSummary: indexHealthSummary,
    layerReadiness,
    workspaceIndexState,
    taskStatuses: workspaceIndexTaskStatuses,
  });

  useEffect(() => {
    if (!workspace?.rootPath) {
      setIndexDiagnostics(null);
      setCurrentFileReadiness(null);
      setLayerReadiness(null);
      setTaskPublicationFallbackKey("");
      layerReadinessRequestIdRef.current += 1;
      workspaceIndexProjectionStore.reset();
      clearDiagnosticsRebuildPoll();
      return;
    }
    if (!indexDiagnosticsVisible || !layerReadiness) return;
    void refreshLayerReadiness();
  }, [indexDiagnosticsVisible, workspace?.rootPath, activePath]);

  useEffect(() => {
    if (!indexDiagnosticsVisible) return;
    void refreshCurrentFileReadiness();
  }, [indexDiagnosticsVisible, workspace?.rootPath, activePath]);

  useEffect(() => {
    if (!indexDiagnosticsVisible || !workspace?.rootPath) {
      setDiagnosticsProjection(null);
      return;
    }
    const rootPath = workspace.rootPath;
    const refreshProjection = () => {
      const projection = workspaceIndexProjectionStore.snapshot();
      setDiagnosticsProjection(projection.rootPath === rootPath ? projection : null);
    };
    refreshProjection();
    return workspaceIndexProjectionStore.subscribe(refreshProjection);
  }, [indexDiagnosticsVisible, workspace?.rootPath]);

  useEffect(() => () => clearDiagnosticsRebuildPoll(), []);

  async function refreshWorkspaceIndexTaskStatuses(rootPath = workspace?.rootPath) {
    await loadWorkspaceIndexTaskStatuses(rootPath);
  }

  async function loadWorkspaceIndexTaskStatuses(rootPath = workspace?.rootPath) {
    if (!rootPath || !workspaceApi.getWorkspaceIndexTaskStatuses) return [];
    const reconciliation = workspaceIndexProjectionStore.beginTaskStatusReconciliation(rootPath);
    const statuses = await workspaceApi.getWorkspaceIndexTaskStatuses(rootPath);
    if (workspaceIndexProjectionStore.replaceTaskStatuses(rootPath, statuses, reconciliation)) {
      setTaskPublicationFallbackKey(workspaceIndexTaskPublicationFallbackKey(
        workspaceIndexProjectionStore.snapshot().taskStatuses,
      ));
    }
    await Promise.all([
      statuses.some(isTerminalProjectIndexTaskStatus)
        ? refreshLayerReadiness(rootPath)
        : Promise.resolve(),
      statuses.some(shouldRefreshDetailedIndexState)
        ? refreshWorkspaceIndexHealth(rootPath)
        : Promise.resolve(),
    ]);
    return statuses;
  }

  function recordWorkspaceIndexTaskStatus(status: WorkspaceIndexTaskStatus) {
    workspaceIndexProjectionStore.recordTaskStatus(status);
    setTaskPublicationFallbackKey(workspaceIndexTaskPublicationFallbackKey(
      workspaceIndexProjectionStore.snapshot().taskStatuses,
    ));
    if (isTerminalProjectIndexTaskStatus(status)) {
      void refreshLayerReadiness(status.rootPath);
    }
    if (shouldRefreshDetailedIndexState(status)) {
      void refreshWorkspaceIndexHealth(status.rootPath);
    }
  }

  function shouldRefreshDetailedIndexState(status: WorkspaceIndexTaskStatus) {
    if (status.kind === "sdk") return false;
    if (status.status === "ready" || status.status === "failed") return true;
    return indexDiagnosticsVisible && isTerminalIndexTaskStatus(status);
  }

  async function refreshWorkspaceIndexHealth(rootPath = workspace?.rootPath) {
    if (!rootPath || !workspaceApi.getWorkspaceIndexHealth) return;
    try {
      const health = await workspaceApi.getWorkspaceIndexHealth(rootPath);
      workspaceIndexProjectionStore.recordHealthSummary(rootPath, health);
    } catch {
      workspaceIndexProjectionStore.recordHealthSummary(rootPath, null);
    }
  }

  async function refreshLayerReadiness(rootPath = workspace?.rootPath) {
    if (!rootPath || !workspaceApi.getWorkspaceIndexLayerReadiness) return;
    const requestId = layerReadinessRequestIdRef.current + 1;
    layerReadinessRequestIdRef.current = requestId;
    try {
      const layers = await workspaceApi.getWorkspaceIndexLayerReadiness(rootPath, activePath);
      if (
        layerReadinessRequestIdRef.current === requestId
        && workspaceRootPathRef.current === rootPath
      ) {
        setLayerReadiness(layers);
      }
    } catch {
      if (
        layerReadinessRequestIdRef.current === requestId
        && workspaceRootPathRef.current === rootPath
      ) {
        setLayerReadiness(null);
      }
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
      const reconciliation = workspaceIndexProjectionStore.beginTaskStatusReconciliation(workspace.rootPath);
      const layerRequestId = layerReadinessRequestIdRef.current + 1;
      layerReadinessRequestIdRef.current = layerRequestId;
      const [diagnostics, statuses, layers] = await Promise.all([
        workspaceApi.inspectWorkspaceIndex?.(workspace.rootPath) ?? Promise.resolve(null),
        workspaceApi.getWorkspaceIndexTaskStatuses?.(workspace.rootPath) ?? Promise.resolve([]),
        workspaceApi.getWorkspaceIndexLayerReadiness
          ? workspaceApi.getWorkspaceIndexLayerReadiness(workspace.rootPath, activePath)
          : Promise.resolve(null),
      ]);
      setIndexDiagnostics(diagnostics);
      workspaceIndexProjectionStore.recordHealthSummary(workspace.rootPath, diagnostics);
      workspaceIndexProjectionStore.recordRecentEvents(workspace.rootPath, diagnostics?.recentEvents ?? []);
      if (workspaceIndexProjectionStore.replaceTaskStatuses(workspace.rootPath, statuses, reconciliation)) {
        setTaskPublicationFallbackKey(workspaceIndexTaskPublicationFallbackKey(
          workspaceIndexProjectionStore.snapshot().taskStatuses,
        ));
      }
      await refreshCurrentFileReadiness(workspace.rootPath, activePath);
      if (
        layerReadinessRequestIdRef.current === layerRequestId
        && workspaceRootPathRef.current === workspace.rootPath
      ) {
        setLayerReadiness(layers);
      }
    } finally {
      setIndexDiagnosticsLoading(false);
    }
  }

  function openIndexDiagnostics(sectionTarget: string | null = null) {
    setIndexDiagnosticsSectionTarget(sectionTarget);
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
    scheduleDiagnosticsRebuildPoll(workspace.rootPath);
  }

  async function indexCurrentFileFromDiagnostics() {
    if (!workspace?.rootPath || !activePath || !workspaceApi.scheduleForegroundNavigationIndex) {
      onStatusChange("Index Current File unavailable");
      return;
    }
    onStatusChange("Index Current File requested");
    await workspaceApi.scheduleForegroundNavigationIndex(workspace.rootPath, [activePath]);
    await refreshIndexDiagnostics();
  }

  function clearDiagnosticsRebuildPoll() {
    if (!diagnosticsRebuildPollRef.current) return;
    window.clearTimeout(diagnosticsRebuildPollRef.current);
    diagnosticsRebuildPollRef.current = null;
  }

  function scheduleDiagnosticsRebuildPoll(rootPath: string) {
    clearDiagnosticsRebuildPoll();
    diagnosticsRebuildPollRef.current = window.setTimeout(() => {
      diagnosticsRebuildPollRef.current = null;
      void pollDiagnosticsRebuildStatus(rootPath);
    }, DIAGNOSTICS_REBUILD_POLL_INTERVAL_MS);
  }

  async function pollDiagnosticsRebuildStatus(rootPath: string) {
    const statuses = await loadWorkspaceIndexTaskStatuses(rootPath);
    const active = statuses.some((status) => status.kind !== "sdk" && !isTerminalIndexTaskStatus(status));
    if (active) {
      scheduleDiagnosticsRebuildPoll(rootPath);
    }
  }

  async function waitForWorkspaceIndexTaskReady(rootPath: string, taskId: string) {
    if (!workspaceApi.getWorkspaceIndexTaskStatuses) return;
    for (let attempt = 0; attempt < SDK_INDEX_READY_WAIT_ATTEMPTS; attempt += 1) {
      const reconciliation = workspaceIndexProjectionStore.beginTaskStatusReconciliation(rootPath);
      const statuses = await workspaceApi.getWorkspaceIndexTaskStatuses(rootPath);
      const current = statuses.find((status) => status.taskId === taskId);
      if (current?.status === "ready") {
        workspaceIndexProjectionStore.replaceTaskStatuses(rootPath, statuses, reconciliation);
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
    indexDiagnosticsSectionTarget,
    indexDiagnosticsLoading,
    indexDiagnostics: effectiveIndexDiagnostics,
    currentFileReadiness,
    layerReadiness,
    taskPublicationFallbackKey,
    workspaceIndexTaskStatuses,
    workspaceIndexStatusSummary,
    recordWorkspaceIndexTaskStatus,
    refreshWorkspaceIndexTaskStatuses,
    refreshIndexDiagnostics,
    openIndexDiagnostics,
    resumeIndexingFromDiagnostics,
    rebuildProjectIndexFromDiagnostics,
    rebuildSdkIndexFromDiagnostics,
    indexCurrentFileFromDiagnostics,
    indexSdkSymbolsForSettings,
    explainIndexMiss,
    rebuildIndexFromExplainPanel,
    openSettingsFromExplainPanel,
    retryLatestExplainQuery,
  };
}
