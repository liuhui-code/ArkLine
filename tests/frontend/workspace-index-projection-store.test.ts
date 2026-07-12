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
