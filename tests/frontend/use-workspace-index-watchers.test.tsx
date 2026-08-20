import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceIndexWatchers } from "@/components/layout/use-workspace-index-watchers";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type {
  WorkspaceApi,
  WorkspaceIndexEvent,
  WorkspaceIndexRefreshResult,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-api";

describe("useWorkspaceIndexWatchers", () => {
  beforeEach(() => {
    workspaceIndexProjectionStore.reset();
  });

  it("records live backend index events into the projection store", async () => {
    let onEvent: ((event: WorkspaceIndexEvent) => void) | null = null;
    const teardown = vi.fn();
    const watchWorkspaceIndexEvents = vi.fn(async (_rootPath: string, next: (event: WorkspaceIndexEvent) => void) => {
      onEvent = next;
      return teardown;
    });

    const { unmount } = renderHook(() => useWorkspaceIndexWatchers({
      rootPath: "/workspace",
      workspaceApi: { watchWorkspaceIndexEvents } as unknown as WorkspaceApi,
      applyWorkspaceIndexRefreshResult: vi.fn(),
      refreshWorkspaceIndexTaskStatuses: vi.fn(async () => undefined),
      recordWorkspaceIndexTaskStatus: vi.fn(),
      onStatusChange: vi.fn(),
    }));

    await waitFor(() => expect(watchWorkspaceIndexEvents).toHaveBeenCalled());
    act(() => {
      onEvent?.(indexEvent({ message: "recommended retry delay 5000ms" }));
    });

    expect(workspaceIndexProjectionStore.snapshot().healthSummary).toEqual({
      retryBackoffCount: 1,
      latestRetryBackoff: "recommended retry delay 5000ms",
    });
    unmount();
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("uses live refresh events instead of polling when a watcher is available", async () => {
    const rootPath = "/workspace";
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const applyWorkspaceIndexRefreshResult = vi.fn();
    const teardown = vi.fn();
    let onChange: ((result: WorkspaceIndexRefreshResult) => void) | null = null;
    const watchWorkspaceIndex = vi.fn(async (
      receivedRootPath: string,
      next: (result: WorkspaceIndexRefreshResult) => void,
    ) => {
      expect(receivedRootPath).toBe(rootPath);
      onChange = next;
      return teardown;
    });

    const { unmount } = renderHook(() => useWorkspaceIndexWatchers({
      rootPath,
      workspaceApi: {
        watchWorkspaceIndex,
        refreshWorkspaceIndexWithChanges: vi.fn(),
      } as unknown as WorkspaceApi,
      applyWorkspaceIndexRefreshResult,
      refreshWorkspaceIndexTaskStatuses: vi.fn(async () => undefined),
      recordWorkspaceIndexTaskStatus: vi.fn(),
      onStatusChange: vi.fn(),
    }));

    try {
      await waitFor(() => expect(watchWorkspaceIndex).toHaveBeenCalledTimes(1));
      expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 5_000);

      act(() => {
        onChange?.(indexRefreshResult(rootPath));
      });

      await waitFor(() => expect(applyWorkspaceIndexRefreshResult).toHaveBeenCalledWith(
        indexRefreshResult(rootPath),
      ));
    } finally {
      unmount();
      setIntervalSpy.mockRestore();
    }

    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("does not replay the latest refresh result when callback identities change", async () => {
    const rootPath = "/workspace";
    const firstApply = vi.fn();
    const secondApply = vi.fn();
    let onChange: ((result: WorkspaceIndexRefreshResult) => void) | null = null;
    const watchWorkspaceIndex = vi.fn(async (
      _rootPath: string,
      next: (result: WorkspaceIndexRefreshResult) => void,
    ) => {
      onChange = next;
      return vi.fn();
    });
    const workspaceApi = { watchWorkspaceIndex } as unknown as WorkspaceApi;

    const { rerender } = renderHook(
      ({ apply, onStatusChange }) => useWorkspaceIndexWatchers({
        rootPath,
        workspaceApi,
        applyWorkspaceIndexRefreshResult: apply,
        refreshWorkspaceIndexTaskStatuses: vi.fn(async () => undefined),
        recordWorkspaceIndexTaskStatus: vi.fn(),
        onStatusChange,
      }),
      {
        initialProps: {
          apply: firstApply,
          onStatusChange: vi.fn(),
        },
      },
    );

    await waitFor(() => expect(watchWorkspaceIndex).toHaveBeenCalledTimes(1));
    act(() => {
      onChange?.(indexRefreshResult(rootPath));
    });
    await waitFor(() => expect(firstApply).toHaveBeenCalledTimes(1));

    rerender({ apply: secondApply, onStatusChange: vi.fn() });

    expect(secondApply).not.toHaveBeenCalled();
    expect(watchWorkspaceIndex).toHaveBeenCalledTimes(1);
  });

  it("does not refetch workspace state from task status notifications", async () => {
    const rootPath = "/workspace";
    const applyWorkspaceIndexRefreshResult = vi.fn();
    let onTaskStatus: ((status: WorkspaceIndexTaskStatus) => void) | null = null;
    const getWorkspaceIndexState = vi.fn(async () => indexRefreshResult(rootPath).state);
    const watchWorkspaceIndexTaskStatuses = vi.fn(async (
      _rootPath: string,
      next: (status: WorkspaceIndexTaskStatus) => void,
    ) => {
      onTaskStatus = next;
      return vi.fn();
    });

    renderHook(() => useWorkspaceIndexWatchers({
      rootPath,
      workspaceApi: {
        getWorkspaceIndexState,
        watchWorkspaceIndexTaskStatuses,
      } as unknown as WorkspaceApi,
      applyWorkspaceIndexRefreshResult,
      refreshWorkspaceIndexTaskStatuses: vi.fn(async () => undefined),
      recordWorkspaceIndexTaskStatus: vi.fn(),
      onStatusChange: vi.fn(),
    }));

    await waitFor(() => expect(watchWorkspaceIndexTaskStatuses).toHaveBeenCalledTimes(1));
    act(() => {
      onTaskStatus?.(indexTaskStatus({ status: "ready" }));
    });

    expect(getWorkspaceIndexState).not.toHaveBeenCalled();
    expect(applyWorkspaceIndexRefreshResult).not.toHaveBeenCalled();
  });
});

function indexRefreshResult(rootPath: string): WorkspaceIndexRefreshResult {
  return {
    state: {
      status: "ready",
      rootPath,
      filePaths: [`${rootPath}/src/main.ets`],
      indexedAt: 1,
      partialReason: null,
    },
    changed: true,
    addedPaths: [`${rootPath}/src/main.ets`],
    removedPaths: [],
  };
}

function indexEvent(overrides: Partial<WorkspaceIndexEvent> = {}): WorkspaceIndexEvent {
  return {
    eventId: "backoff",
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

function indexTaskStatus(overrides: Partial<WorkspaceIndexTaskStatus> = {}): WorkspaceIndexTaskStatus {
  return {
    taskId: "1:changed-paths",
    rootPath: "/workspace",
    kind: "changed-paths",
    status: "partial",
    reason: "full-refresh-deep:background-refresh-after-open",
    generation: 1,
    progressCurrent: 1,
    progressTotal: 1,
    targetPaths: [],
    targetPathCount: null,
    startedAt: 1,
    lastHeartbeatAt: 1,
    stalled: false,
    finishedAt: 1,
    symbolCount: null,
    message: "Deep refresh catalog complete",
    error: null,
    ...overrides,
  };
}
