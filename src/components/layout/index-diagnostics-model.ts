import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-api";
import type { QueryExplainTimelineItem } from "@/features/workspace/workspace-query-explain-model";
import { formatPerformanceEventEvidence } from "@/components/layout/index-diagnostics-performance-evidence";
import { repairActionFromPayload } from "@/features/workspace/workspace-index-repair-action-model";

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
  targetSummary: string | null;
  targetCurrentFile: boolean;
};

export type RepairActionEvidence = {
  action: string;
  source: string;
  detail: string;
};

export type IndexDiagnosticsEvidenceReportInput = {
  diagnostics: WorkspaceIndexDiagnostics | null;
  fileReadiness: WorkspaceIndexFileReadiness | null;
  layerReadiness: WorkspaceIndexLayerReadinessReport | null;
  queryTimeline: QueryExplainTimelineItem[];
  taskStatuses: WorkspaceIndexTaskStatus[];
  activePath: string | null;
};

export function buildActiveProjectTaskSummary(
  tasks: WorkspaceIndexTaskStatus[],
  currentFilePath: string | null = null,
): ActiveProjectTaskSummary | null {
  const task = tasks.find((candidate) => candidate.kind !== "sdk" && !isTerminalTaskStatus(candidate.status));
  if (!task) {
    return null;
  }
  return buildActiveTaskSummary(task, "Project index task", currentFilePath);
}

export function buildActiveSdkTaskSummary(
  tasks: WorkspaceIndexTaskStatus[],
  currentFilePath: string | null = null,
): ActiveProjectTaskSummary | null {
  const task = tasks.find((candidate) => candidate.kind === "sdk" && !isTerminalTaskStatus(candidate.status));
  if (!task) {
    return null;
  }
  return buildActiveTaskSummary(task, "SDK index task", currentFilePath);
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
    case "indexCurrentFile":
      return "Index Current File";
    case "inspectIndex":
      return "Inspect Index";
    case "resumeIndexing":
      return "Resume Indexing";
    case "inspectUnresolvedImports":
      return "Inspect Unresolved Imports";
    case "inspectParserFailures":
      return "Inspect Parser Failures";
    default:
      return action;
  }
}

export function buildRepairActionEvidence(
  diagnostics: Pick<WorkspaceIndexDiagnostics, "recentEvents"> | null,
): RepairActionEvidence[] {
  if (!diagnostics) {
    return [];
  }
  const seen = new Set<string>();
  const evidence: RepairActionEvidence[] = [];
  for (const event of [...diagnostics.recentEvents].reverse()) {
    if (event.scope !== "query") {
      continue;
    }
    const action = repairActionFromPayload(event.payloadJson);
    if (!action || seen.has(action)) {
      continue;
    }
    seen.add(action);
    evidence.push({
      action,
      source: `${event.kind} ${event.phase}`,
      detail: event.message || "Query explain recommended this repair action.",
    });
  }
  return evidence.slice(0, 3);
}

export function buildIndexDiagnosticsEvidenceReport(input: IndexDiagnosticsEvidenceReportInput) {
  const diagnostics = input.diagnostics;
  const lines = [
    "# ArkLine Index Diagnostics Evidence",
    `workspace: ${diagnostics?.rootPath ?? "none"}`,
    `activePath: ${input.activePath ?? "none"}`,
    "",
    "## Health",
    `status: ${diagnostics?.status ?? "unknown"}`,
    `files: ${diagnostics?.fileCount ?? 0}`,
    `symbols: ${diagnostics?.symbolCount ?? 0}`,
    `textRows: ${diagnostics?.contentLineCount ?? 0}`,
    `fingerprints: ${diagnostics?.fingerprintCount ?? 0}`,
    `stubFiles: ${diagnostics?.stubFileCount ?? 0}`,
    `stubDeclarations: ${diagnostics?.stubDeclarationCount ?? 0}`,
    `dependencyEdges: ${diagnostics?.dependencyEdgeCount ?? 0}`,
    `sdkSymbols: ${diagnostics?.sdkSymbolCount ?? 0}`,
    `discovery: ${diagnostics?.discoveryStatus ?? "none"}`,
    `discoveredFiles: ${diagnostics?.discoveredFileCount ?? 0}`,
    `discoveryExcluded: ${diagnostics?.discoveryExcludedCount ?? 0}`,
    `discoveryHasMore: ${diagnostics?.discoveryHasMore ? "yes" : "no"}`,
    `parserErrors: ${diagnostics?.parserErrorCount ?? 0}`,
    `unresolvedImports: ${diagnostics?.unresolvedImportCount ?? 0}`,
    `staleFiles: ${diagnostics?.staleGenerationCount ?? 0}`,
    `dbSize: ${formatBytes(diagnostics?.dbSizeBytes ?? 0)}`,
    `lastError: ${diagnostics?.lastError ?? "none"}`,
    `lastExplain: ${diagnostics?.lastExplainStatus ?? "none"}`,
    `retryBackoff: ${diagnostics?.latestRetryBackoff ?? "none"}`,
    `repairActions: ${formatRepairActionList(diagnostics?.repairActions ?? [])}`,
    "",
    "## Freshness",
    ...formatFreshnessLayerEvidence(diagnostics),
    "",
    "## Current File",
    ...formatCurrentFileEvidence(input.fileReadiness),
    "",
    "## Queue",
    `pending: ${diagnostics?.queuePressure.pendingTaskCount ?? 0}`,
    `workspacePending: ${diagnostics?.queuePressure.workspacePendingTaskCount ?? 0}`,
    `topPriority: ${diagnostics?.queuePressure.highestPriority ?? "none"}`,
    `topTask: ${diagnostics?.queuePressure.highestPriorityTaskKind ?? "none"}`,
    ...formatTaskEvidence(input.taskStatuses),
    "",
    "## Layers",
    ...formatLayerEvidence(input.layerReadiness),
    "",
    "## Query Explain",
    ...formatQueryExplainEvidence(input.queryTimeline),
    "",
    "## Recent Events",
    ...formatRecentEventEvidence(diagnostics),
  ];
  return `${lines.join("\n")}\n`;
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

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatRepairActionList(actions: string[]) {
  if (actions.length === 0) {
    return "none";
  }
  return actions.map((action) => `${action} (${formatRepairAction(action)})`).join(", ");
}

function formatCurrentFileEvidence(fileReadiness: WorkspaceIndexFileReadiness | null) {
  if (!fileReadiness) {
    return ["readiness: unavailable"];
  }
  return [
    `path: ${fileReadiness.path}`,
    `file: ${fileReadiness.fileName}`,
    `discovery: ${fileReadiness.discoveryIndex}`,
    `fileIndex: ${fileReadiness.fileIndex}`,
    `contentIndex: ${fileReadiness.contentIndex}`,
    `symbolIndex: ${fileReadiness.symbolIndex}`,
    `parser: ${fileReadiness.parserStatus}`,
    `definition: ${fileReadiness.definitionAvailable ? "available" : "unavailable"}`,
    `completion: ${fileReadiness.completionAvailable ? "available" : "unavailable"}`,
    `usages: ${fileReadiness.usagesAvailable ? "available" : "unavailable"}`,
    `search: ${fileReadiness.searchAvailable ? "available" : "unavailable"}`,
    `reason: ${fileReadiness.reason || "none"}`,
  ];
}

function formatTaskEvidence(tasks: WorkspaceIndexTaskStatus[]) {
  if (tasks.length === 0) {
    return ["tasks: none"];
  }
  return tasks.slice(0, 8).map((task) => (
    `task: ${task.kind} ${task.status} ${formatTaskProgress(task)} ${formatTaskDetails(task)}`.trim()
  ));
}

function formatLayerEvidence(layerReadiness: WorkspaceIndexLayerReadinessReport | null) {
  if (!layerReadiness) {
    return ["layers: unavailable"];
  }
  return layerReadiness.layers.map((layer) => (
    `layer: ${layer.layer} workspace=${layer.workspaceStatus} current=${layer.currentFileStatus ?? "n/a"} `
    + `counts=${layer.indexedCount}/${layer.failedCount}/${layer.staleCount} action=${layer.recommendedAction ?? "none"}`
  ));
}

function formatFreshnessLayerEvidence(diagnostics: WorkspaceIndexDiagnostics | null) {
  const layers = diagnostics?.freshnessLayers ?? [];
  if (layers.length === 0) {
    return ["freshness: unavailable"];
  }
  return layers.map((layer) => (
    `freshness: ${layer.layer} ready=${layer.readyCount} stale=${layer.staleCount} `
    + `missing=${layer.missingCount} expectedVersion=${layer.expectedVersion}`
  ));
}

function formatQueryExplainEvidence(queryTimeline: QueryExplainTimelineItem[]) {
  if (queryTimeline.length === 0) {
    return ["queries: none"];
  }
  return queryTimeline.slice(0, 5).map((item) => {
    const metrics = item.summary?.searchMetrics ? ` metrics=${item.summary.searchMetrics}` : "";
    const action = item.summary?.action ? ` action=${item.summary.action}` : "";
    const resultCount = item.summary?.resultCount ? ` results=${item.summary.resultCount}` : "";
    const readiness = item.summary?.readiness ? ` readiness=${item.summary.readiness}` : "";
    const generation = item.summary?.generation ? ` generation=${item.summary.generation}` : "";
    const retryable = item.summary?.retryable ? ` retryable=${item.summary.retryable}` : "";
    const used = item.summary?.used ? ` used=${item.summary.used}` : "";
    const skipped = item.summary?.skipped ? ` skipped=${item.summary.skipped}` : "";
    return `query: ${item.source}/${item.severity} ${item.message}${action}${resultCount}`
      + `${readiness}${generation}${retryable}${used}${skipped}${metrics}`.trimEnd();
  });
}

function formatRecentEventEvidence(diagnostics: WorkspaceIndexDiagnostics | null) {
  const events = diagnostics?.recentEvents ?? [];
  if (events.length === 0) {
    return ["events: none"];
  }
  return events.slice(-8).reverse().flatMap((event) => [
    ...formatPerformanceEventEvidence(event),
    `event: ${event.scope}/${event.kind}/${event.phase} ${event.severity} ${event.message}`.trim(),
  ]);
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
  return TERMINAL_TASK_STATUSES.has(status);
}

const TERMINAL_TASK_STATUSES = new Set([
  "ready",
  "partial",
  "stale",
  "failed",
  "cancelled",
  "superseded",
  "skipped",
]);

function buildActiveTaskSummary(
  task: WorkspaceIndexTaskStatus,
  titlePrefix: string,
  currentFilePath: string | null,
): ActiveProjectTaskSummary {
  const targets = formatTaskTargets(task);
  return {
    title: `${titlePrefix} ${task.stalled ? "stalled" : task.status}`,
    kind: task.kind,
    status: task.stalled ? "stalled" : task.status,
    progress: formatTaskProgress(task),
    duration: formatTaskDuration(task),
    detail: formatTaskDetails(task),
    targetSummary: targets === "-" ? null : targets,
    targetCurrentFile: taskTargetsCurrentFile(task, currentFilePath),
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
  return taskTargetsCurrentFile(task, currentFilePath);
}

function isForegroundNavigationTask(task: WorkspaceIndexTaskStatus) {
  return task.kind === "foreground-navigation" || task.reason === "foreground-navigation";
}

function taskTargetsCurrentFile(task: WorkspaceIndexTaskStatus, currentFilePath: string | null) {
  if (!currentFilePath || !task.targetPaths || task.targetPaths.length === 0) {
    return false;
  }
  const current = comparablePath(currentFilePath);
  return task.targetPaths.some((path) => comparablePath(path) === current);
}

function comparablePath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+/g, "/").toLowerCase();
}

function actionStateFromTask(task: WorkspaceIndexTaskStatus | undefined, label: string) {
  if (!task) {
    return { disabled: false, reason: null };
  }
  return { disabled: true, reason: `${label}: ${task.status} ${formatTaskProgress(task)}` };
}
