import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

const invoke = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("workspace device log query worker API", () => {
  beforeEach(() => {
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("invokes desktop device log query worker stats command", async () => {
    invoke.mockResolvedValueOnce({
      running: true,
      queued: 1,
      completedQueries: 2,
      cancelledQueries: 3,
      failedQueries: 0,
      lastQueryMs: 12,
      lastError: null,
    });

    const result = await defaultWorkspaceApi.getDeviceLogQueryWorkerStats?.();

    expect(invoke).toHaveBeenCalledWith("get_device_log_query_worker_stats");
    expect(result?.running).toBe(true);
    expect(result?.queued).toBe(1);
    expect(result?.cancelledQueries).toBe(3);
  });

  it("invokes desktop device log query worker events command", async () => {
    invoke.mockResolvedValueOnce([{
      sequence: 7,
      streamId: "stream-1",
      query: "width",
      status: "completed",
      durationMs: 18,
      error: null,
    }]);

    const result = await defaultWorkspaceApi.getDeviceLogQueryWorkerEvents?.();

    expect(invoke).toHaveBeenCalledWith("get_device_log_query_worker_events");
    expect(result?.[0]?.query).toBe("width");
    expect(result?.[0]?.status).toBe("completed");
    expect(result?.[0]?.durationMs).toBe(18);
  });
});
