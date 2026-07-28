import {
  getIndexHealthStatusText,
  getIndexStatusText,
  getLayerReadinessStatusText,
  getSdkIndexStatusText,
} from "@/components/layout/app-shell-model";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-api";
import type {
  WorkspaceIndexHealthSummary,
  WorkspaceIndexProjectionSnapshot,
} from "@/features/workspace/workspace-index-projection-store";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

export function mergeIndexDiagnosticsProjection(
  diagnostics: WorkspaceIndexDiagnostics | null,
  projection: WorkspaceIndexProjectionSnapshot | null,
): WorkspaceIndexDiagnostics | null {
  if (!diagnostics || !projection) {
    return diagnostics;
  }
  return {
    ...diagnostics,
    lastError: projection.errorSummary?.lastError ?? diagnostics.lastError,
    lastExplainStatus: projection.explainSummary?.lastExplainStatus ?? diagnostics.lastExplainStatus,
    retryBackoffCount: projection.healthSummary?.retryBackoffCount ?? diagnostics.retryBackoffCount,
    latestRetryBackoff: projection.healthSummary?.latestRetryBackoff ?? diagnostics.latestRetryBackoff,
    repairActions: mergeRepairActions(diagnostics.repairActions, projection.repairSummary?.repairActions ?? []),
    recentEvents: projection.recentEvents.length > 0 ? projection.recentEvents : diagnostics.recentEvents,
    timeline: mergeDiagnosticsTimeline(diagnostics.timeline, projection.timeline),
  };
}

function mergeDiagnosticsTimeline(
  backendTimeline: WorkspaceIndexDiagnostics["timeline"],
  projectedTimeline: WorkspaceIndexProjectionSnapshot["timeline"],
) {
  const merged = new Map<string, WorkspaceIndexDiagnostics["timeline"][number]>();
  for (const item of backendTimeline) {
    merged.set(timelineIdentity(item), item);
  }
  for (const item of projectedTimeline) {
    merged.set(timelineIdentity(item), item);
  }
  return [...merged.values()].sort((left, right) => left.occurredAt - right.occurredAt);
}

function timelineIdentity(item: WorkspaceIndexDiagnostics["timeline"][number]) {
  return [item.taskId ?? "", item.occurredAt, item.scope, item.kind, item.phase, item.message].join("\u0000");
}

function mergeRepairActions(base: string[], projected: string[]) {
  return [...new Set([...base, ...projected])];
}

export function workspaceIndexStatusSummary(input: {
  diagnostics: WorkspaceIndexDiagnostics | null;
  healthSummary: WorkspaceIndexHealthSummary | null;
  layerReadiness: WorkspaceIndexLayerReadinessReport | null;
  workspaceIndexState: WorkspaceIndexState;
  taskStatuses: WorkspaceIndexTaskStatus[];
}) {
  return {
    workspaceIndexText: getIndexHealthStatusText(input.diagnostics)
      ?? getIndexHealthStatusText(input.healthSummary
        ? { ...input.healthSummary, lastError: null, repairActions: [] }
        : null)
      ?? getLayerReadinessStatusText(input.layerReadiness)
      ?? getIndexStatusText(input.workspaceIndexState, input.taskStatuses),
    sdkIndexText: getSdkIndexStatusText(input.taskStatuses),
  };
}

export function isTerminalIndexTaskStatus(status: WorkspaceIndexTaskStatus) {
  return status.status === "ready"
    || status.status === "partial"
    || status.status === "stale"
    || status.status === "failed";
}

export function isTerminalProjectIndexTaskStatus(status: WorkspaceIndexTaskStatus) {
  return status.kind !== "sdk" && isTerminalIndexTaskStatus(status);
}
