import type { WorkspaceIndexHealth, WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-index-api-types";
import type { WorkspaceIndexRefreshResult } from "@/features/workspace/workspace-api-contract";

export type WorkspaceIndexHealthSummary = Pick<WorkspaceIndexHealth, "retryBackoffCount" | "latestRetryBackoff">;

export type WorkspaceIndexProjectionSnapshot = {
  rootPath: string | null;
  refreshResult: WorkspaceIndexRefreshResult | null;
  refreshEventCount: number;
  healthSummary: WorkspaceIndexHealthSummary | null;
  taskStatuses: WorkspaceIndexTaskStatus[];
  eventCount: number;
  updatedAt: number | null;
};

type Listener = () => void;

function createInitialSnapshot(): WorkspaceIndexProjectionSnapshot {
  return {
    rootPath: null,
    refreshResult: null,
    refreshEventCount: 0,
    healthSummary: null,
    taskStatuses: [],
    eventCount: 0,
    updatedAt: null,
  };
}

export function createWorkspaceIndexProjectionStore(flushMs = 500) {
  let snapshot = createInitialSnapshot();
  const listeners = new Set<Listener>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      listeners.forEach((listener) => listener());
    }, flushMs);
  }

  function commit(next: WorkspaceIndexProjectionSnapshot) {
    snapshot = next;
    scheduleFlush();
  }

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot() {
      return snapshot;
    },
    reset() {
      commit(createInitialSnapshot());
    },
    replaceTaskStatuses(rootPath: string, statuses: WorkspaceIndexTaskStatus[]) {
      commit({
        ...snapshot,
        rootPath,
        taskStatuses: [...statuses],
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      });
    },
    recordTaskStatus(status: WorkspaceIndexTaskStatus) {
      const current = snapshot.rootPath === status.rootPath ? snapshot.taskStatuses : [];
      commit({
        ...snapshot,
        rootPath: status.rootPath,
        taskStatuses: mergeTaskStatus(current, status),
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      });
    },
    recordHealthSummary(rootPath: string, healthSummary: WorkspaceIndexHealthSummary | null) {
      commit({
        ...snapshot,
        rootPath,
        healthSummary,
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      });
    },
    recordRefreshResult(rootPath: string, result: WorkspaceIndexRefreshResult) {
      commit({
        ...snapshot,
        rootPath,
        refreshResult: result,
        refreshEventCount: snapshot.refreshEventCount + 1,
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      });
    },
  };
}

function mergeTaskStatus(
  statuses: WorkspaceIndexTaskStatus[],
  next: WorkspaceIndexTaskStatus,
) {
  const retained = statuses.filter((status) => status.taskId !== next.taskId);
  return [...retained, next].sort((left, right) => left.generation - right.generation);
}

export const workspaceIndexProjectionStore = createWorkspaceIndexProjectionStore();
