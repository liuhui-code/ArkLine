import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";

export type IndexDiagnosticsModelInput = {
  diagnostics: {
    status: string;
    fileCount: number;
    dbSizeBytes: number;
    timelineCount: number;
  } | null;
  layerStatusText: string | null;
  uiLatencyCount: number;
  ipcLatencyCount: number;
  renderPressureCount: number;
};

export function buildIndexDiagnosticsViewModel(input: IndexDiagnosticsModelInput) {
  const headerStatusText = input.layerStatusText
    ?? (input.diagnostics
      ? `${input.diagnostics.status} · ${input.diagnostics.fileCount.toLocaleString()} files`
      : "Workspace index evidence");
  return {
    headerStatusText,
    dbSize: formatBytes(input.diagnostics?.dbSizeBytes ?? 0),
    timelineCount: performanceTimelineCount(
      input.diagnostics?.timelineCount ?? 0,
      input.uiLatencyCount,
      input.ipcLatencyCount,
      input.renderPressureCount,
    ),
  };
}

export function formatTaskProgress(task: WorkspaceIndexTaskStatus) {
  const total = task.progressTotal;
  const current = task.progressCurrent;
  if (total <= 0) {
    return `${current}/${total}`;
  }
  const percentage = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  return `${current}/${total} (${percentage}%)`;
}

export function formatTaskDuration(task: WorkspaceIndexTaskStatus) {
  const startedAt = task.startedAt;
  if (startedAt == null) {
    return "not started";
  }
  if (task.finishedAt != null) {
    return `${formatDurationMs(task.finishedAt - startedAt)} total`;
  }
  if (task.lastHeartbeatAt != null) {
    return `${formatDurationMs(task.lastHeartbeatAt - startedAt)} active`;
  }
  return "started";
}

export function formatTaskDetails(task: WorkspaceIndexTaskStatus) {
  const detail = firstNonEmpty(task.error, task.message, task.reason);
  if (!task.stalled) {
    return detail;
  }
  if (detail.toLowerCase().includes("no heartbeat")) {
    return "No heartbeat > 60s";
  }
  return detail ? `${detail} · No heartbeat > 60s` : "No heartbeat > 60s";
}

export function formatTaskTargets(task: WorkspaceIndexTaskStatus) {
  const paths = task.targetPaths ?? [];
  if (paths.length === 0) {
    return "-";
  }
  const visible = paths.map(formatCompactPath).join(", ");
  const total = task.targetPathCount ?? paths.length;
  const remaining = Math.max(0, total - paths.length);
  return remaining > 0 ? `${visible} +${remaining} more` : visible;
}

export type ActiveProjectTaskSummary = {
  title: string;
  kind: string;
  status: string;
  progress: string;
  duration: string;
  detail: string;
};

export function buildActiveProjectTaskSummary(tasks: WorkspaceIndexTaskStatus[]): ActiveProjectTaskSummary | null {
  const task = tasks.find((candidate) => candidate.kind !== "sdk" && !isTerminalTaskStatus(candidate.status));
  if (!task) {
    return null;
  }
  return buildActiveTaskSummary(task, "Project index task");
}

export function buildActiveSdkTaskSummary(tasks: WorkspaceIndexTaskStatus[]): ActiveProjectTaskSummary | null {
  const task = tasks.find((candidate) => candidate.kind === "sdk" && !isTerminalTaskStatus(candidate.status));
  if (!task) {
    return null;
  }
  return buildActiveTaskSummary(task, "SDK index task");
}

export function formatLayerCounts(layer: { indexedCount: number; failedCount: number; staleCount: number }) {
  return `${layer.indexedCount.toLocaleString()} indexed · ${layer.failedCount.toLocaleString()} failed · ${layer.staleCount.toLocaleString()} stale`;
}

export function getLayerActionState(
  action: string | null,
  tasks: WorkspaceIndexTaskStatus[],
  currentFilePath: string | null = null,
) {
  if (action == null || action === "none" || action === "wait") {
    return { disabled: false, reason: null };
  }
  if (action === "indexCurrentFile") {
    return actionStateFromTask(
      tasks.find((task) => isActiveForegroundNavigationForPath(task, currentFilePath)),
      "Foreground navigation indexing is already active",
    );
  }
  if (action === "configureSdk" || action === "rebuildSdkIndex") {
    return actionStateFromTask(
      tasks.find((task) => task.kind === "sdk" && !isTerminalTaskStatus(task.status)),
      "SDK indexing is already active",
    );
  }
  if (action === "rebuildIndex") {
    return actionStateFromTask(
      tasks.find((task) => task.kind !== "sdk" && !isTerminalTaskStatus(task.status)),
      "Project indexing is already active",
    );
  }
  return { disabled: false, reason: null };
}

export function formatClockTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString();
}

export function formatRepairAction(action: string) {
  switch (action) {
    case "rebuildProjectIndex":
      return "Rebuild Project Index";
    case "rebuildSdkIndex":
      return "Rebuild SDK Index";
    case "configureSdk":
      return "Configure SDK";
    case "inspectUnresolvedImports":
      return "Inspect Unresolved Imports";
    case "inspectParserFailures":
      return "Inspect Parser Failures";
    default:
      return action;
  }
}

function formatBytes(bytes: number) {
  if (bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024).toLocaleString()} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDurationMs(durationMs: number) {
  const clampedMs = Math.max(0, durationMs);
  if (clampedMs < 1000) {
    return `${clampedMs}ms`;
  }
  if (clampedMs < 60_000) {
    return `${(clampedMs / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(clampedMs / 60_000)}m ${Math.floor((clampedMs % 60_000) / 1000)}s`;
}

function formatCompactPath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return parts.join("/") || path;
  }
  return parts.slice(-2).join("/");
}

function performanceTimelineCount(backendCount: number, uiCount: number, ipcCount: number, renderCount: number) {
  return backendCount + uiCount + ipcCount + renderCount;
}

function isTerminalTaskStatus(status: string) {
  return status === "ready" || status === "partial" || status === "stale" || status === "failed";
}

function buildActiveTaskSummary(task: WorkspaceIndexTaskStatus, titlePrefix: string): ActiveProjectTaskSummary {
  return {
    title: `${titlePrefix} ${task.stalled ? "stalled" : task.status}`,
    kind: task.kind,
    status: task.stalled ? "stalled" : task.status,
    progress: formatTaskProgress(task),
    duration: formatTaskDuration(task),
    detail: formatTaskDetails(task),
  };
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value != null && value.trim().length > 0) ?? "";
}

function isActiveForegroundNavigationForPath(task: WorkspaceIndexTaskStatus, currentFilePath: string | null) {
  if (!isForegroundNavigationTask(task) || isTerminalTaskStatus(task.status)) {
    return false;
  }
  if (!currentFilePath || !task.targetPaths || task.targetPaths.length === 0) {
    return true;
  }
  return task.targetPaths.includes(currentFilePath);
}

function isForegroundNavigationTask(task: WorkspaceIndexTaskStatus) {
  return task.kind === "foreground-navigation" || task.reason === "foreground-navigation";
}

function actionStateFromTask(task: WorkspaceIndexTaskStatus | undefined, label: string) {
  if (!task) {
    return { disabled: false, reason: null };
  }
  return { disabled: true, reason: `${label}: ${task.status} ${formatTaskProgress(task)}` };
}
