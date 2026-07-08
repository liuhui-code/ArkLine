import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-index-api-types";

export type WorkspaceIndexProjectionSnapshot = {
  rootPath: string | null;
  taskStatuses: WorkspaceIndexTaskStatus[];
  eventCount: number;
  updatedAt: number | null;
};

type Listener = () => void;

function createInitialSnapshot(): WorkspaceIndexProjectionSnapshot {
  return {
    rootPath: null,
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
        rootPath,
        taskStatuses: [...statuses],
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      });
    },
    recordTaskStatus(status: WorkspaceIndexTaskStatus) {
      const current = snapshot.rootPath === status.rootPath ? snapshot.taskStatuses : [];
      commit({
        rootPath: status.rootPath,
        taskStatuses: mergeTaskStatus(current, status),
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
