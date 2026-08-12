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
});

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
