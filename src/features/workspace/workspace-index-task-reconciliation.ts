import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-index-api-types";

export type WorkspaceIndexTaskReconciliation = Readonly<{
  rootPath: string;
  eventRevision: number;
  requestSequence: number;
}>;

export function createWorkspaceIndexTaskReconciler() {
  let eventRevision = 0;
  let requestSequence = 0;
  const revisions = new Map<string, number>();
  const appliedRequestSequences = new Map<string, number>();

  return {
    reset() {
      eventRevision = 0;
      requestSequence = 0;
      revisions.clear();
      appliedRequestSequences.clear();
    },
    begin(rootPath: string): WorkspaceIndexTaskReconciliation {
      requestSequence += 1;
      return { rootPath, eventRevision, requestSequence };
    },
    record(status: WorkspaceIndexTaskStatus) {
      eventRevision += 1;
      revisions.set(revisionKey(status.rootPath, status.taskId), eventRevision);
    },
    reconcile(
      current: WorkspaceIndexTaskStatus[],
      incoming: WorkspaceIndexTaskStatus[],
      rootPath: string,
      reconciliation: WorkspaceIndexTaskReconciliation,
    ) {
      const appliedRequestSequence = appliedRequestSequences.get(rootPath) ?? 0;
      if (
        reconciliation.rootPath !== rootPath
        || reconciliation.requestSequence < appliedRequestSequence
      ) {
        return null;
      }
      appliedRequestSequences.set(rootPath, reconciliation.requestSequence);
      const reconciled = new Map(incoming.map((status) => [status.taskId, status]));
      for (const status of current) {
        const statusRevision = revisions.get(revisionKey(rootPath, status.taskId)) ?? 0;
        if (statusRevision > reconciliation.eventRevision) {
          reconciled.set(status.taskId, status);
        }
      }
      return [...reconciled.values()].sort((left, right) => left.generation - right.generation);
    },
  };
}

export function isLatestTaskGenerationForKind(
  status: WorkspaceIndexTaskStatus,
  statuses: WorkspaceIndexTaskStatus[],
) {
  return statuses.every((candidate) => (
    candidate.rootPath !== status.rootPath
    || candidate.kind !== status.kind
    || candidate.generation <= status.generation
  ));
}

function revisionKey(rootPath: string, taskId: string) {
  return `${rootPath}\u0000${taskId}`;
}
