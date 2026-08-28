import type {
  WorkspaceIndexEvent,
  WorkspaceIndexHealth,
  WorkspaceIndexTimelineItem,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-index-api-types";
import type { WorkspaceIndexRefreshResult } from "@/features/workspace/workspace-api-contract";
import { repairActionFromPayload } from "@/features/workspace/workspace-index-repair-action-model";
import { createWorkspaceIndexTaskReconciler, isQueryPublicationTaskStatus } from "@/features/workspace/workspace-index-task-reconciliation";

export type WorkspaceIndexHealthSummary = Pick<WorkspaceIndexHealth, "retryBackoffCount" | "latestRetryBackoff">;

const RETRY_BACKOFF_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];
const MAX_RECENT_EVENTS = 64;

export type WorkspaceIndexExplainSummary = {
  lastExplainStatus: string | null;
};

export type WorkspaceIndexErrorSummary = {
  lastError: string | null;
};

export type WorkspaceIndexRepairSummary = {
  repairActions: string[];
};

export type WorkspaceIndexProjectionSnapshot = {
  rootPath: string | null;
  refreshResult: WorkspaceIndexRefreshResult | null;
  refreshEventCount: number;
  healthSummary: WorkspaceIndexHealthSummary | null;
  explainSummary: WorkspaceIndexExplainSummary | null;
  errorSummary: WorkspaceIndexErrorSummary | null;
  repairSummary: WorkspaceIndexRepairSummary | null;
  taskStatuses: WorkspaceIndexTaskStatus[];
  queryRevision: number;
  recentEvents: WorkspaceIndexEvent[];
  timeline: WorkspaceIndexTimelineItem[];
  eventCount: number;
  updatedAt: number | null;
};

type Listener = () => void;

export type WorkspaceIndexStatusProjection = Pick<
  WorkspaceIndexProjectionSnapshot,
  "rootPath" | "healthSummary" | "taskStatuses" | "updatedAt"
>;

function createInitialSnapshot(): WorkspaceIndexProjectionSnapshot {
  return {
    rootPath: null,
    refreshResult: null,
    refreshEventCount: 0,
    healthSummary: null,
    explainSummary: null,
    errorSummary: null,
    repairSummary: null,
    taskStatuses: [],
    queryRevision: 0,
    recentEvents: [],
    timeline: [],
    eventCount: 0,
    updatedAt: null,
  };
}

export function createWorkspaceIndexProjectionStore(flushMs = 500) {
  let snapshot = createInitialSnapshot();
  let statusProjection: WorkspaceIndexStatusProjection = statusProjectionFrom(snapshot);
  const taskStatusReconciler = createWorkspaceIndexTaskReconciler();
  const listeners = new Set<Listener>();
  const statusListeners = new Set<Listener>();
  const queryListeners = new Set<Listener>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let statusFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let queryFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      listeners.forEach((listener) => listener());
    }, flushMs);
  }
  function scheduleStatusFlush() {
    if (statusFlushTimer) return;
    statusFlushTimer = setTimeout(() => {
      statusFlushTimer = null;
      statusListeners.forEach((listener) => listener());
    }, flushMs);
  }
  function scheduleQueryFlush() {
    if (queryFlushTimer) return;
    queryFlushTimer = setTimeout(() => {
      queryFlushTimer = null;
      queryListeners.forEach((listener) => listener());
    }, flushMs);
  }
  function clearScheduledFlushes() {
    if (flushTimer != null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (statusFlushTimer != null) {
      clearTimeout(statusFlushTimer);
      statusFlushTimer = null;
    }
    if (queryFlushTimer != null) {
      clearTimeout(queryFlushTimer);
      queryFlushTimer = null;
    }
  }

  function commit(next: WorkspaceIndexProjectionSnapshot, includeStatus = false, includeQuery = false) {
    snapshot = next;
    scheduleFlush();
    if (includeStatus) {
      const nextStatusProjection = statusProjectionFrom(next);
      if (!sameStatusProjection(statusProjection, nextStatusProjection)) {
        statusProjection = nextStatusProjection;
        scheduleStatusFlush();
      }
    }
    if (includeQuery) {
      scheduleQueryFlush();
    }
  }

  return {
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeStatus(listener: Listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    subscribeQuery(listener: Listener) {
      queryListeners.add(listener);
      return () => {
        queryListeners.delete(listener);
      };
    },
    snapshot() {
      return snapshot;
    },
    statusSnapshot() {
      return statusProjection;
    },
    querySnapshot() {
      return snapshot.queryRevision;
    },
    reset() {
      clearScheduledFlushes();
      taskStatusReconciler.reset();
      commit(createInitialSnapshot(), true, true);
    },
    taskStatusRevision() {
      return taskStatusReconciler.revision();
    },
    replaceTaskStatuses(
      rootPath: string,
      statuses: WorkspaceIndexTaskStatus[],
      reconciliationRevision = taskStatusReconciler.revision(),
    ) {
      const taskStatuses = taskStatusReconciler.reconcile(
        snapshot.rootPath === rootPath ? snapshot.taskStatuses : [],
        statuses,
        rootPath,
        reconciliationRevision,
      );
      commit({
        ...snapshot,
        rootPath,
        taskStatuses,
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      }, true);
    },
    recordTaskStatus(status: WorkspaceIndexTaskStatus) {
      taskStatusReconciler.record(status);
      const queryPublication = isQueryPublicationTaskStatus(status.status);
      const current = snapshot.rootPath === status.rootPath ? snapshot.taskStatuses : [];
      const taskStatuses = mergeTaskStatus(current, status);
      const healthSummary = isActiveDeepRefresh(status)
        ? undefined
        : healthSummaryFromTaskStatuses(status, taskStatuses);
      commit({
        ...snapshot,
        rootPath: status.rootPath,
        healthSummary: healthSummary === undefined ? snapshot.healthSummary : healthSummary,
        taskStatuses,
        queryRevision: snapshot.queryRevision + Number(queryPublication),
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      }, true, queryPublication);
    },
    recordHealthSummary(rootPath: string, healthSummary: WorkspaceIndexHealthSummary | null) {
      commit({
        ...snapshot,
        rootPath,
        healthSummary,
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      }, true);
    },
    recordRecentEvents(rootPath: string, events: WorkspaceIndexEvent[]) {
      const current = snapshot.rootPath === rootPath ? snapshot.recentEvents : [];
      const recentEvents = mergeRecentEvents(current, events);
      const healthSummary = healthSummaryFromEvents(recentEvents);
      const explainSummary = explainSummaryFromEvents(recentEvents);
      const errorSummary = errorSummaryFromEvents(recentEvents);
      const repairSummary = repairSummaryFromEvents(recentEvents);
      const timeline = timelineFromEvents(recentEvents);
      commit({
        ...snapshot,
        rootPath,
        recentEvents,
        timeline,
        healthSummary: healthSummary === undefined ? snapshot.healthSummary : healthSummary,
        explainSummary: explainSummary === undefined ? snapshot.explainSummary : explainSummary,
        errorSummary: errorSummary === undefined ? snapshot.errorSummary : errorSummary,
        repairSummary: repairSummary === undefined ? snapshot.repairSummary : repairSummary,
        eventCount: snapshot.eventCount + 1,
        updatedAt: Date.now(),
      });
    },
    recordRecentEvent(rootPath: string, event: WorkspaceIndexEvent) {
      const current = snapshot.rootPath === rootPath ? snapshot.recentEvents : [];
      const recentEvents = mergeRecentEvent(current, event);
      const healthSummary = healthSummaryFromEvents(recentEvents);
      const explainSummary = explainSummaryFromEvents(recentEvents);
      const errorSummary = errorSummaryFromEvents(recentEvents);
      const repairSummary = repairSummaryFromEvents(recentEvents);
      const timeline = timelineFromEvents(recentEvents);
      commit({
        ...snapshot,
        rootPath,
        recentEvents,
        timeline,
        healthSummary: healthSummary === undefined ? snapshot.healthSummary : healthSummary,
        explainSummary: explainSummary === undefined ? snapshot.explainSummary : explainSummary,
        errorSummary: errorSummary === undefined ? snapshot.errorSummary : errorSummary,
        repairSummary: repairSummary === undefined ? snapshot.repairSummary : repairSummary,
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

function statusProjectionFrom(snapshot: WorkspaceIndexProjectionSnapshot): WorkspaceIndexStatusProjection {
  return {
    rootPath: snapshot.rootPath,
    healthSummary: snapshot.healthSummary,
    taskStatuses: snapshot.taskStatuses
      .filter(isShellStatusTask)
      .map(projectStatusTask),
    updatedAt: snapshot.updatedAt,
  };
}

function isShellStatusTask(status: WorkspaceIndexTaskStatus) {
  return status.kind !== "changed-paths"
    || isActiveDeepRefresh(status)
    || status.stalled === true
    || status.status === "failed";
}

function sameStatusProjection(
  current: WorkspaceIndexStatusProjection,
  next: WorkspaceIndexStatusProjection,
) {
  return current.rootPath === next.rootPath
    && sameHealthSummary(current.healthSummary, next.healthSummary)
    && sameStatusTasks(current.taskStatuses, next.taskStatuses);
}

function projectStatusTask(status: WorkspaceIndexTaskStatus): WorkspaceIndexTaskStatus {
  if (!isActiveDeepRefresh(status)) {
    return status;
  }
  return {
    ...status,
    status: "running",
    startedAt: undefined,
    lastHeartbeatAt: undefined,
    finishedAt: undefined,
    message: "Background deep index running",
  };
}

function isActiveDeepRefresh(status: WorkspaceIndexTaskStatus) {
  return status.kind === "changed-paths"
    && status.reason.startsWith("full-refresh-deep:")
    && (status.status === "queued" || status.status === "running" || status.status === "partial");
}

function sameHealthSummary(
  left: WorkspaceIndexHealthSummary | null,
  right: WorkspaceIndexHealthSummary | null,
) {
  return left?.retryBackoffCount === right?.retryBackoffCount
    && left?.latestRetryBackoff === right?.latestRetryBackoff;
}

function sameStatusTasks(left: WorkspaceIndexTaskStatus[], right: WorkspaceIndexTaskStatus[]) {
  return left.length === right.length && left.every((status, index) => sameStatusTask(status, right[index]));
}

function sameStatusTask(left: WorkspaceIndexTaskStatus, right: WorkspaceIndexTaskStatus | undefined) {
  return right != null
    && left.taskId === right.taskId
    && left.rootPath === right.rootPath
    && left.kind === right.kind
    && left.status === right.status
    && left.reason === right.reason
    && left.generation === right.generation
    && left.progressCurrent === right.progressCurrent
    && left.progressTotal === right.progressTotal
    && left.stalled === right.stalled
    && left.symbolCount === right.symbolCount
    && left.message === right.message
    && left.error === right.error;
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

function explainSummaryFromEvents(events: WorkspaceIndexEvent[]): WorkspaceIndexExplainSummary | undefined {
  const latest = [...events].reverse().find((event) => event.scope === "query");
  if (!latest) {
    return undefined;
  }
  return {
    lastExplainStatus: latest.phase || null,
  };
}

function errorSummaryFromEvents(events: WorkspaceIndexEvent[]): WorkspaceIndexErrorSummary | undefined {
  const latest = [...events].reverse().find((event) => event.severity === "error");
  if (!latest) {
    return undefined;
  }
  return {
    lastError: latest.message || null,
  };
}

function repairSummaryFromEvents(events: WorkspaceIndexEvent[]): WorkspaceIndexRepairSummary | undefined {
  const actions: string[] = [];
  for (const event of [...events].reverse()) {
    const action = repairActionFromEvent(event);
    if (!action || actions.includes(action)) {
      continue;
    }
    actions.push(action);
    if (actions.length >= 3) {
      break;
    }
  }
  return actions.length === 0 ? undefined : { repairActions: actions };
}

function repairActionFromEvent(event: WorkspaceIndexEvent): string | null {
  if (event.scope !== "query") {
    return null;
  }
  return repairActionFromPayload(event.payloadJson);
}

function mergeRecentEvent(events: WorkspaceIndexEvent[], next: WorkspaceIndexEvent) {
  const retained = events.filter((event) => event.eventId !== next.eventId);
  const merged = [...retained, next].sort((left, right) => left.createdAt - right.createdAt);
  return merged.slice(Math.max(0, merged.length - MAX_RECENT_EVENTS));
}

function mergeRecentEvents(current: WorkspaceIndexEvent[], next: WorkspaceIndexEvent[]) {
  return next.reduce((events, event) => mergeRecentEvent(events, event), current);
}

function timelineFromEvents(events: WorkspaceIndexEvent[]): WorkspaceIndexTimelineItem[] {
  const lastByTaskId = new Map<string, number>();
  return events.map((event) => {
    const previousAt = event.taskId == null ? undefined : lastByTaskId.get(event.taskId);
    if (event.taskId != null) {
      lastByTaskId.set(event.taskId, event.createdAt);
    }
    return {
      scope: event.scope,
      kind: event.kind,
      phase: event.phase,
      title: `${event.kind} ${event.phase}`,
      severity: event.severity,
      message: event.message,
      taskId: event.taskId,
      generation: event.generation,
      occurredAt: event.createdAt,
      durationMs: previousAt == null ? null : Math.max(0, event.createdAt - previousAt),
    };
  });
}

function mergeTaskStatus(
  statuses: WorkspaceIndexTaskStatus[],
  next: WorkspaceIndexTaskStatus,
) {
  const previous = statuses.find((status) => status.taskId === next.taskId);
  const merged = preserveDeepRefreshProgress(previous, next);
  const retained = statuses.filter((status) => status.taskId !== next.taskId);
  return [...retained, merged].sort((left, right) => left.generation - right.generation);
}

function preserveDeepRefreshProgress(
  previous: WorkspaceIndexTaskStatus | undefined,
  next: WorkspaceIndexTaskStatus,
) {
  if (!previous || !isActiveDeepRefresh(next) || previous.progressTotal <= 1) {
    return next;
  }
  if (next.progressTotal <= 1) {
    return {
      ...next,
      progressCurrent: previous.progressCurrent,
      progressTotal: previous.progressTotal,
    };
  }
  if (next.progressTotal !== previous.progressTotal) {
    return next;
  }
  return {
    ...next,
    progressCurrent: Math.max(previous.progressCurrent, next.progressCurrent),
  };
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
