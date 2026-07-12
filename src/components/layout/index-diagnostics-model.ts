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
  return {
    title: `Project index task ${task.stalled ? "stalled" : task.status}`,
    kind: task.kind,
    status: task.stalled ? "stalled" : task.status,
    progress: formatTaskProgress(task),
    duration: formatTaskDuration(task),
    detail: formatTaskDetails(task),
  };
}

export function formatLayerCounts(layer: { indexedCount: number; failedCount: number; staleCount: number }) {
  return `${layer.indexedCount.toLocaleString()} indexed · ${layer.failedCount.toLocaleString()} failed · ${layer.staleCount.toLocaleString()} stale`;
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

function performanceTimelineCount(backendCount: number, uiCount: number, ipcCount: number, renderCount: number) {
  return backendCount + uiCount + ipcCount + renderCount;
}

function isTerminalTaskStatus(status: string) {
  return status === "ready" || status === "partial" || status === "stale" || status === "failed";
}

function firstNonEmpty(...values: Array<string | undefined>) {
  return values.find((value) => value != null && value.trim().length > 0) ?? "";
}
