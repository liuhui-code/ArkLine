import type {
  WorkspaceIndexEvent,
  WorkspaceIndexHealth,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-index-api-types";
import type { WorkspaceIndexRefreshResult } from "@/features/workspace/workspace-api-contract";

export type WorkspaceIndexHealthSummary = Pick<WorkspaceIndexHealth, "retryBackoffCount" | "latestRetryBackoff">;

const RETRY_BACKOFF_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];

export type WorkspaceIndexProjectionSnapshot = {
  rootPath: string | null;
  refreshResult: WorkspaceIndexRefreshResult | null;
  refreshEventCount: number;
  healthSummary: WorkspaceIndexHealthSummary | null;
  taskStatuses: WorkspaceIndexTaskStatus[];
  recentEvents: WorkspaceIndexEvent[];
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
    recentEvents: [],
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
      const taskStatuses = mergeTaskStatus(current, status);
      const healthSummary = healthSummaryFromTaskStatuses(status, taskStatuses);
      commit({
        ...snapshot,
        rootPath: status.rootPath,
        healthSummary: healthSummary === undefined ? snapshot.healthSummary : healthSummary,
        taskStatuses,
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
    recordRecentEvents(rootPath: string, events: WorkspaceIndexEvent[]) {
      const healthSummary = healthSummaryFromEvents(events);
      commit({
        ...snapshot,
        rootPath,
        recentEvents: [...events],
        healthSummary: healthSummary === undefined ? snapshot.healthSummary : healthSummary,
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

function healthSummaryFromEvents(events: WorkspaceIndexEvent[]): WorkspaceIndexHealthSummary | undefined {
  const backoffEvents = events.filter((event) => event.scope === "scheduler" && event.phase === "backoff");
  const latest = backoffEvents.at(-1);
  if (!latest) {
    return undefined;
  }
  return {
    retryBackoffCount: backoffEvents.length,
    latestRetryBackoff: latest.message || null,
  };
}

function mergeTaskStatus(
  statuses: WorkspaceIndexTaskStatus[],
  next: WorkspaceIndexTaskStatus,
) {
  const retained = statuses.filter((status) => status.taskId !== next.taskId);
  return [...retained, next].sort((left, right) => left.generation - right.generation);
}

function healthSummaryFromTaskStatuses(
  current: WorkspaceIndexTaskStatus,
  statuses: WorkspaceIndexTaskStatus[],
): WorkspaceIndexHealthSummary | null | undefined {
  if (current.status !== "failed") {
    return isTerminalTaskStatus(current.status) ? { retryBackoffCount: 0, latestRetryBackoff: null } : undefined;
  }
  let failureCount = 0;
  const matching = statuses
    .filter((status) => (
      status.rootPath === current.rootPath
      && status.kind === current.kind
      && status.reason === current.reason
    ))
    .reverse();
  for (const status of matching) {
    if (status.status !== "failed") {
      break;
    }
    failureCount += 1;
  }
  if (failureCount < 2) {
    return undefined;
  }
  const delay = RETRY_BACKOFF_DELAYS_MS[Math.min(failureCount - 2, RETRY_BACKOFF_DELAYS_MS.length - 1)];
  return {
    retryBackoffCount: 1,
    latestRetryBackoff: `${current.kind} failed ${failureCount} consecutive time(s); recommended retry delay ${delay}ms`,
  };
}

function isTerminalTaskStatus(status: string) {
  return TERMINAL_TASK_STATUSES.has(status);
}

const TERMINAL_TASK_STATUSES = new Set(["ready", "partial", "stale", "cancelled", "superseded", "skipped"]);

export const workspaceIndexProjectionStore = createWorkspaceIndexProjectionStore();
