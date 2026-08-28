import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-index-api-types";

export function createWorkspaceIndexTaskReconciler() {
  let revision = 0;
  const revisions = new Map<string, number>();

  return {
    reset() {
      revision = 0;
      revisions.clear();
    },
    revision() {
      return revision;
    },
    record(status: WorkspaceIndexTaskStatus) {
      revision += 1;
      revisions.set(revisionKey(status.rootPath, status.taskId), revision);
    },
    reconcile(
      current: WorkspaceIndexTaskStatus[],
      incoming: WorkspaceIndexTaskStatus[],
      rootPath: string,
      reconciliationRevision: number,
    ) {
      const reconciled = new Map(incoming.map((status) => [status.taskId, status]));
      for (const status of current) {
        const statusRevision = revisions.get(revisionKey(rootPath, status.taskId)) ?? 0;
        if (statusRevision > reconciliationRevision) {
          reconciled.set(status.taskId, status);
        }
      }
      return [...reconciled.values()].sort((left, right) => left.generation - right.generation);
    },
  };
}

export function isQueryPublicationTaskStatus(status: string) {
  return QUERY_PUBLICATION_TASK_STATUSES.has(status);
}

function revisionKey(rootPath: string, taskId: string) {
  return `${rootPath}\u0000${taskId}`;
}

const QUERY_PUBLICATION_TASK_STATUSES = new Set([
  "ready",
  "partial",
  "stale",
  "failed",
  "cancelled",
  "superseded",
  "skipped",
]);
