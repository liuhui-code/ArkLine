import {
  COMPLETION_POPUP_FALLBACK_POSITION,
  COMPLETION_POPUP_GAP,
  COMPLETION_POPUP_HEIGHT,
  COMPLETION_POPUP_MARGIN,
  COMPLETION_POPUP_WIDTH,
} from "@/components/layout/app-shell-constants";
import {
  buildActiveProjectTaskSummary,
  buildActiveSdkTaskSummary,
  formatRepairAction,
} from "@/components/layout/index-diagnostics-model";
import type { CodeAction } from "@/features/code-actions/code-action-model";
import type {
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
  WorkspaceIndexDiagnostics,
  WorkspaceViewModel,
  WorkspaceIndexQueryScope,
} from "@/features/workspace/workspace-api";
import type { SearchCandidate, WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import { normalizePath } from "@/features/workspace/workspace-store";
import type { EditorCaretRect } from "@/editor/editor-events";

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function actionMatchesSource(action: CodeAction, source: "all" | "rename" | "generate" | "refactor") {
  if (source === "all") {
    return true;
  }

  const searchable = `${action.id} ${action.title} ${action.kind}`.toLowerCase();
  if (source === "rename") {
    return searchable.includes("rename");
  }
  if (source === "generate") {
    return searchable.includes("generate") || action.kind === "source";
  }

  return action.kind.startsWith("refactor")
    || searchable.includes("refactor")
    || searchable.includes("extract")
    || searchable.includes("inline");
}

export function uniqueNormalizedPaths(paths: string[]) {
  return [...new Set(paths.map(normalizePath))].sort((left, right) => left.localeCompare(right));
}

export function pathWithinDirectory(path: string, directoryPath: string) {
  const normalizedPath = normalizePath(path);
  const normalizedDirectory = normalizePath(directoryPath).replace(/[\\/]+$/g, "");
  const separator = normalizedDirectory.includes("\\") ? "\\" : "/";
  return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}${separator}`);
}

export function replaceDirectoryPrefix(path: string, oldDirectoryPath: string, newDirectoryPath: string) {
  const normalizedPath = normalizePath(path);
  const normalizedOld = normalizePath(oldDirectoryPath).replace(/[\\/]+$/g, "");
  const normalizedNew = normalizePath(newDirectoryPath).replace(/[\\/]+$/g, "");
  return `${normalizedNew}${normalizedPath.slice(normalizedOld.length)}`;
}

export function constrainCompletionPopupPosition(top: number, left: number) {
  if (typeof window === "undefined") {
    return { top, left };
  }

  const maxLeft = window.innerWidth - COMPLETION_POPUP_WIDTH - COMPLETION_POPUP_MARGIN;
  return {
    top: Math.max(COMPLETION_POPUP_MARGIN, top),
    left: clampNumber(left, COMPLETION_POPUP_MARGIN, maxLeft),
  };
}

export function getCompletionPopupPosition(anchor: EditorCaretRect | null) {
  if (!anchor?.measured) {
    return constrainCompletionPopupPosition(COMPLETION_POPUP_FALLBACK_POSITION.top, COMPLETION_POPUP_FALLBACK_POSITION.left);
  }

  if (typeof window === "undefined") {
    return { top: anchor.bottom + COMPLETION_POPUP_GAP, left: anchor.left };
  }

  const belowTop = anchor.bottom + COMPLETION_POPUP_GAP;
  const hasSpaceBelow = belowTop + COMPLETION_POPUP_HEIGHT + COMPLETION_POPUP_MARGIN <= window.innerHeight;
  const preferredTop = hasSpaceBelow ? belowTop : anchor.top - COMPLETION_POPUP_HEIGHT - COMPLETION_POPUP_GAP;

  return constrainCompletionPopupPosition(preferredTop, anchor.left);
}

export function getWorkspaceScanText(workspace: WorkspaceViewModel | null) {
  if (!workspace) {
    return null;
  }

  return workspace.scanSummary.truncated
    ? `Workspace: partial (${workspace.visibleFiles.length.toLocaleString()} files)`
    : `Workspace: ready (${workspace.visibleFiles.length.toLocaleString()} files)`;
}

export function getWorkspacePartialNotice(workspace: WorkspaceViewModel | null) {
  if (!workspace?.scanSummary.truncated) {
    return null;
  }

  return `Partial workspace results: scan stopped at ${workspace.scanSummary.scannedFiles.toLocaleString()} files; excluded ${workspace.scanSummary.skippedEntries.toLocaleString()} generated/dependency entries.`;
}

export function getIndexStatusText(indexState: WorkspaceIndexState, taskStatuses: WorkspaceIndexTaskStatus[] = []) {
  const stalledTasks = taskStatuses.filter((status) => status.kind !== "sdk" && status.stalled);
  if (stalledTasks.length > 0) {
    const suffix = stalledTasks.length === 1 ? "task" : "tasks";
    return `Index: Stalled, ${stalledTasks.length} ${suffix} > 60s`;
  }

  const activeTask = getActiveProjectIndexTaskStatus(taskStatuses);
  if (activeTask) {
    if (activeTask.kind === "discovery") {
      return formatDiscoveryIndexStatus(activeTask);
    }
    const summary = buildActiveProjectTaskSummary([activeTask]);
    const progressText = activeTask.progressTotal > 0 && summary ? ` · ${summary.progress}` : "";
    return `Index: ${activeTask.status} ${projectIndexTaskLabel(activeTask.kind)}${progressText}`;
  }

  if (indexState.status === "empty") {
    return "Index: empty";
  }

  if (indexState.status === "partial" && indexState.filePaths.length === 0) {
    return "Index: building project";
  }

  return `Index: ${indexState.status} (${indexState.filePaths.length.toLocaleString()} files)`;
}

export function getIndexHealthStatusText(
  diagnostics: Pick<WorkspaceIndexDiagnostics, "retryBackoffCount" | "latestRetryBackoff" | "lastError" | "repairActions"> | null,
) {
  const backoffCount = diagnostics?.retryBackoffCount ?? 0;
  if (backoffCount > 0) {
    const suffix = backoffCount === 1 ? "retry delayed" : "retries delayed";
    return diagnostics?.latestRetryBackoff
      ? `Index: Backoff, ${diagnostics.latestRetryBackoff}`
      : `Index: Backoff, ${backoffCount.toLocaleString()} ${suffix}`;
  }
  if (diagnostics?.lastError) {
    return `Index: Error, ${diagnostics.lastError}`;
  }
  const action = diagnostics?.repairActions[0];
  return action ? `Index: Needs ${formatRepairAction(action)}` : null;
}

export function getIndexDiagnosticsStatusTarget(workspaceIndexText: string) {
  return workspaceIndexText.startsWith("Index: Backoff")
    || workspaceIndexText.startsWith("Index: Error")
    || workspaceIndexText.startsWith("Index: Needs")
    ? "index-diagnostics-health"
    : "index-diagnostics-processes";
}

export function getActiveProjectIndexTaskStatus(statuses: WorkspaceIndexTaskStatus[]) {
  return [...statuses]
    .reverse()
    .find((status) => status.kind !== "sdk" && isActiveProjectIndexTask(status));
}

function isActiveProjectIndexTask(status: WorkspaceIndexTaskStatus) {
  if (status.status === "queued" || status.status === "running") {
    return true;
  }
  return status.kind === "discovery" && status.status === "partial";
}

function formatDiscoveryIndexStatus(status: WorkspaceIndexTaskStatus) {
  if (status.status === "partial" && status.progressCurrent > 0) {
    return `Index: Discovering files (${status.progressCurrent.toLocaleString()}+)`;
  }
  return "Index: Discovering files";
}

export function projectIndexTaskLabel(kind: string) {
  if (kind === "open-workspace") {
    return "project";
  }
  if (kind === "refresh-workspace") {
    return "refresh";
  }
  if (kind === "changed-paths") {
    return "changes";
  }
  return kind;
}

export function getSdkIndexStatusText(statuses: WorkspaceIndexTaskStatus[]) {
  const sdkStatus = [...statuses].reverse().find((status) => status.kind === "sdk");
  if (!sdkStatus) {
    return null;
  }

  const summary = buildActiveSdkTaskSummary([sdkStatus]);
  if (summary && sdkStatus.stalled) {
    return `SDK API: ${summary.status} · ${summary.detail}`;
  }
  if (summary && sdkStatus.progressTotal > 0) {
    return `SDK API: ${summary.status} · ${summary.progress}`;
  }

  const symbolText = sdkStatus.symbolCount == null
    ? ""
    : ` (${sdkStatus.symbolCount.toLocaleString()} symbols)`;
  return `SDK API: ${sdkStatus.status}${symbolText}`;
}

export function getLayerReadinessStatusText(report: WorkspaceIndexLayerReadinessReport | null) {
  const layers = report?.layers ?? [];
  if (layers.length === 0) {
    return null;
  }

  const failedCount = layers.reduce((count, layer) => count + layer.failedCount, 0);
  if (failedCount > 0 || layers.some((layer) => layer.workspaceStatus === "failed")) {
    return `Index: Degraded, ${failedCount.toLocaleString()} ${failedCount === 1 ? "failure" : "failures"}`;
  }

  const currentFileReady = layers.some((layer) => layer.currentFileStatus === "ready");
  const currentFileBlocked = layers.some((layer) => layer.currentFileStatus === "missing" || layer.currentFileStatus === "failed");
  const workspaceStatuses = new Set(layers.map((layer) => layer.workspaceStatus));
  const suffix = currentFileReady ? ", current file ready" : currentFileBlocked ? ", current file not ready" : "";

  if (workspaceStatuses.has("partial") || workspaceStatuses.has("stale")) {
    return `Index: Partial${suffix}`;
  }
  if (workspaceStatuses.has("missing")) {
    return `Index: Missing${suffix}`;
  }
  return `Index: Ready${suffix}`;
}

export function mergeWorkspaceIndexTaskStatus(
  statuses: WorkspaceIndexTaskStatus[],
  next: WorkspaceIndexTaskStatus,
) {
  const retained = statuses.filter((status) => status.taskId !== next.taskId);
  return [...retained, next].sort((left, right) => left.generation - right.generation);
}

export function filterSearchCandidatesByScope(candidates: SearchCandidate[], scope: WorkspaceIndexQueryScope) {
  if (scope === "all") {
    return candidates;
  }

  const sourceByScope: Partial<Record<WorkspaceIndexQueryScope, SearchCandidate["source"]>> = {
    files: "file",
    classes: "class",
    symbols: "symbol",
    api: "api",
  };
  const source = sourceByScope[scope];
  return source ? candidates.filter((candidate) => candidate.source === source) : candidates;
}

export function searchEverywhereEntityCandidates(candidates: SearchCandidate[]) {
  return candidates.filter((candidate) => candidate.source !== "text");
}
