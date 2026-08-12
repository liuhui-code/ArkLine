import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceIndexWatchers } from "@/components/layout/use-workspace-index-watchers";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type { WorkspaceApi, WorkspaceIndexEvent } from "@/features/workspace/workspace-api";

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

  it("polls external workspace changes and applies the indexed file state", async () => {
    let pollWorkspace: (() => void) | null = null;
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler) => {
      pollWorkspace = handler as () => void;
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });
    const clearIntervalSpy = vi.spyOn(window, "clearInterval").mockImplementation(() => undefined);
    const applyWorkspaceIndexRefreshResult = vi.fn();
    const refreshWorkspaceIndexWithChanges = vi.fn(async () => refreshResult());

    try {
      const { unmount } = renderHook(() => useWorkspaceIndexWatchers({
        rootPath: "/workspace",
        workspaceApi: { refreshWorkspaceIndexWithChanges } as WorkspaceApi,
        applyWorkspaceIndexRefreshResult,
        refreshWorkspaceIndexTaskStatuses: vi.fn(async () => undefined),
        recordWorkspaceIndexTaskStatus: vi.fn(),
        onStatusChange: vi.fn(),
      }));

      expect(pollWorkspace).not.toBeNull();
      await act(async () => {
        pollWorkspace?.();
        await Promise.resolve();
      });
      await waitFor(() => expect(applyWorkspaceIndexRefreshResult).toHaveBeenCalledWith(refreshResult()));

      unmount();
      expect(clearIntervalSpy).toHaveBeenCalledWith(1);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});

function refreshResult() {
  return {
    state: {
      status: "ready" as const,
      rootPath: "/workspace",
      filePaths: ["/workspace/src/About.ets"],
      indexedAt: 1,
      partialReason: null,
    },
    changed: true,
    addedPaths: ["/workspace/src/About.ets"],
    removedPaths: ["/workspace/src/main.ets"],
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
