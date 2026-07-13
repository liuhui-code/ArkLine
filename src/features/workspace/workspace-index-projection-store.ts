import type {
  WorkspaceIndexEvent,
  WorkspaceIndexHealth,
  WorkspaceIndexTimelineItem,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-index-api-types";
import type { WorkspaceIndexRefreshResult } from "@/features/workspace/workspace-api-contract";
import { repairActionFromPayload } from "@/features/workspace/workspace-index-repair-action-model";

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
  recentEvents: WorkspaceIndexEvent[];
  timeline: WorkspaceIndexTimelineItem[];
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
    explainSummary: null,
    errorSummary: null,
    repairSummary: null,
    taskStatuses: [],
    recentEvents: [],
    timeline: [],
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
  const actions = [];
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
