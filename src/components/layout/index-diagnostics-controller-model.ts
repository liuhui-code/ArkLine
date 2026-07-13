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
    repairActions: projection.repairSummary?.repairActions.length
      ? projection.repairSummary.repairActions
      : diagnostics.repairActions,
    recentEvents: projection.recentEvents.length > 0 ? projection.recentEvents : diagnostics.recentEvents,
    timeline: projection.timeline.length > 0 ? projection.timeline : diagnostics.timeline,
  };
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
