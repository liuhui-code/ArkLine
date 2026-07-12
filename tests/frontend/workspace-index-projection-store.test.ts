import { describe, expect, it, vi } from "vitest";
import { createWorkspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type { WorkspaceIndexEvent, WorkspaceIndexRefreshResult, WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";

describe("workspace index projection store", () => {
  it("keeps health summary while task and refresh projections update", () => {
    vi.useFakeTimers();
    const store = createWorkspaceIndexProjectionStore(1);
    const listener = vi.fn();
    store.subscribe(listener);

    store.recordHealthSummary("/workspace", {
      retryBackoffCount: 1,
      latestRetryBackoff: "recommended retry delay 2000ms",
    });
    store.recordTaskStatus(taskStatus({ status: "failed" }));
    store.recordRefreshResult("/workspace", refreshResult());

    expect(store.snapshot()).toMatchObject({
      rootPath: "/workspace",
      healthSummary: {
        retryBackoffCount: 1,
        latestRetryBackoff: "recommended retry delay 2000ms",
      },
      taskStatuses: [expect.objectContaining({ status: "failed" })],
      refreshEventCount: 1,
    });
    vi.runOnlyPendingTimers();
    expect(listener).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("derives retry backoff health from consecutive failed task statuses", () => {
    const store = createWorkspaceIndexProjectionStore(1);

    store.recordTaskStatus(taskStatus({ taskId: "first", status: "failed", generation: 1 }));
    expect(store.snapshot().healthSummary).toBeNull();

    store.recordTaskStatus(taskStatus({ taskId: "second", status: "failed", generation: 2 }));
    expect(store.snapshot().healthSummary).toEqual({
      retryBackoffCount: 1,
      latestRetryBackoff: "refresh-workspace failed 2 consecutive time(s); recommended retry delay 2000ms",
    });

    store.recordTaskStatus(taskStatus({ taskId: "third", status: "ready", generation: 3 }));
    expect(store.snapshot().healthSummary).toEqual({
      retryBackoffCount: 0,
      latestRetryBackoff: null,
    });
  });

  it("derives retry backoff health from backend scheduler events", () => {
    const store = createWorkspaceIndexProjectionStore(1);

    store.recordRecentEvents("/workspace", [
      indexEvent({ eventId: "info", scope: "task", phase: "failed", message: "failed" }),
      indexEvent({ eventId: "backoff", message: "recommended retry delay 5000ms" }),
    ]);

    expect(store.snapshot().recentEvents).toHaveLength(2);
    expect(store.snapshot().healthSummary).toEqual({
      retryBackoffCount: 1,
      latestRetryBackoff: "recommended retry delay 5000ms",
    });
  });

  it("derives last explain status from backend query events", () => {
    const store = createWorkspaceIndexProjectionStore(1);

    store.recordRecentEvents("/workspace", [
      indexEvent({ eventId: "query-miss", scope: "query", kind: "definition", phase: "miss" }),
      indexEvent({ eventId: "query-blocked", scope: "query", kind: "completion", phase: "blocked", createdAt: 2 }),
    ]);

    expect(store.snapshot().explainSummary).toEqual({
      lastExplainStatus: "blocked",
    });
  });

  it("updates last explain status from live query events", () => {
    const store = createWorkspaceIndexProjectionStore(1);

    store.recordRecentEvent(
      "/workspace",
      indexEvent({ eventId: "query-hit", scope: "query", kind: "search", phase: "hit" }),
    );

    expect(store.snapshot().explainSummary).toEqual({
      lastExplainStatus: "hit",
    });
  });

  it("keeps live query events when diagnostics refresh records older events", () => {
    const store = createWorkspaceIndexProjectionStore(1);

    store.recordRecentEvent(
      "/workspace",
      indexEvent({ eventId: "query-miss", scope: "query", kind: "definition", phase: "miss", createdAt: 3 }),
    );
    store.recordRecentEvents("/workspace", [
      indexEvent({ eventId: "backoff", scope: "scheduler", phase: "backoff", createdAt: 2 }),
    ]);

    expect(store.snapshot().recentEvents.map((event) => event.eventId)).toEqual(["backoff", "query-miss"]);
    expect(store.snapshot().explainSummary).toEqual({
      lastExplainStatus: "miss",
    });
  });
});

function taskStatus(overrides: Partial<WorkspaceIndexTaskStatus> = {}): WorkspaceIndexTaskStatus {
  return {
    taskId: "task",
    rootPath: "/workspace",
    kind: "refresh-workspace",
    status: "running",
    reason: "refresh",
    generation: 1,
    progressCurrent: 0,
    progressTotal: 1,
    ...overrides,
  };
}

function refreshResult(): WorkspaceIndexRefreshResult {
  return {
    state: {
      status: "ready",
      rootPath: "/workspace",
      filePaths: ["/workspace/Entry.ets"],
      symbols: [],
      indexedAt: 1,
      partialReason: null,
      queryReadiness: null,
    },
    changed: true,
    addedPaths: ["/workspace/Entry.ets"],
    removedPaths: [],
  };
}

function indexEvent(overrides: Partial<WorkspaceIndexEvent> = {}): WorkspaceIndexEvent {
  return {
    eventId: "event",
    rootPath: "/workspace",
    scope: "scheduler",
    kind: "refresh-workspace",
    phase: "backoff",
    severity: "warning",
    message: "recommended retry delay 2000ms",
    taskId: "task",
    generation: 1,
    payloadJson: "{}",
    createdAt: 1,
    ...overrides,
  };
}
