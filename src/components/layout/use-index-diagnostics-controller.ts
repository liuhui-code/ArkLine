import { useState } from "react";
import {
  SDK_INDEX_READY_WAIT_ATTEMPTS,
  SDK_INDEX_READY_WAIT_INTERVAL_MS,
} from "@/components/layout/app-shell-constants";
import type { IndexExplainContext } from "@/components/layout/app-shell-types";
import { mergeWorkspaceIndexTaskStatus } from "@/components/layout/app-shell-model";
import { formatIndexExplainMessage } from "@/features/workspace/index-explain-model";
import type { AppSettings } from "@/features/settings/settings-store";
import type {
  WorkspaceApi,
  WorkspaceIndexDiagnostics,
  WorkspaceIndexExplainResult,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexRefreshResult,
  WorkspaceIndexTaskStatus,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api";

export type UseIndexDiagnosticsControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
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
  const [workspaceIndexTaskStatuses, setWorkspaceIndexTaskStatuses] = useState<WorkspaceIndexTaskStatus[]>([]);

  async function refreshWorkspaceIndexTaskStatuses(rootPath = workspace?.rootPath) {
    if (!rootPath || !workspaceApi.getWorkspaceIndexTaskStatuses) return;
    const statuses = await workspaceApi.getWorkspaceIndexTaskStatuses(rootPath);
    if (statuses.length > 0) setWorkspaceIndexTaskStatuses(statuses);
  }

  function recordWorkspaceIndexTaskStatus(status: WorkspaceIndexTaskStatus) {
    setWorkspaceIndexTaskStatuses((current) => mergeWorkspaceIndexTaskStatus(current, status));
  }

  async function refreshIndexDiagnostics() {
    if (!workspace?.rootPath) {
      setIndexDiagnostics(null);
      setCurrentFileReadiness(null);
      return;
    }
    setIndexDiagnosticsLoading(true);
    try {
      const [diagnostics, statuses, readiness] = await Promise.all([
        workspaceApi.inspectWorkspaceIndex?.(workspace.rootPath) ?? Promise.resolve(null),
        workspaceApi.getWorkspaceIndexTaskStatuses?.(workspace.rootPath) ?? Promise.resolve([]),
        activePath && workspaceApi.getWorkspaceIndexFileReadiness
          ? workspaceApi.getWorkspaceIndexFileReadiness(workspace.rootPath, activePath)
          : Promise.resolve(null),
      ]);
      setIndexDiagnostics(diagnostics);
      setWorkspaceIndexTaskStatuses(statuses);
      setCurrentFileReadiness(readiness);
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
    setWorkspaceIndexTaskStatuses((previous) => mergeWorkspaceIndexTaskStatus(previous, status));
    await refreshIndexDiagnostics();
    onStatusChange("Rebuild SDK Index requested");
  }

  async function waitForWorkspaceIndexTaskReady(rootPath: string, taskId: string) {
    if (!workspaceApi.getWorkspaceIndexTaskStatuses) return;
    for (let attempt = 0; attempt < SDK_INDEX_READY_WAIT_ATTEMPTS; attempt += 1) {
      const statuses = await workspaceApi.getWorkspaceIndexTaskStatuses(rootPath);
      const current = statuses.find((status) => status.taskId === taskId);
      if (current?.status === "ready") {
        setWorkspaceIndexTaskStatuses(statuses);
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
      setWorkspaceIndexTaskStatuses((current) => mergeWorkspaceIndexTaskStatus(current, queued));
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
    workspaceIndexTaskStatuses,
    recordWorkspaceIndexTaskStatus,
    refreshWorkspaceIndexTaskStatuses,
    refreshIndexDiagnostics,
    openIndexDiagnostics,
    resumeIndexingFromDiagnostics,
    rebuildSdkIndexFromDiagnostics,
    indexSdkSymbolsForSettings,
    explainIndexMiss,
    rebuildIndexFromExplainPanel,
    openSettingsFromExplainPanel,
    retryLatestExplainQuery,
  };
}
