import { describe, expect, it, vi } from "vitest";
import { createWorkspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type { WorkspaceIndexRefreshResult, WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";

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
