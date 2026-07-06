import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

const invoke = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
}));

describe("workspace device log storage API", () => {
  beforeEach(() => {
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("invokes desktop device log storage clear command", async () => {
    invoke.mockResolvedValueOnce({
      removedFileCount: 2,
      removedBytes: 4096,
    });

    const result = await defaultWorkspaceApi.clearDeviceLogStorage?.();

    expect(invoke).toHaveBeenCalledWith("clear_device_log_storage");
    expect(result?.removedFileCount).toBe(2);
  });

  it("invokes desktop device log retention plan command", async () => {
    invoke.mockResolvedValueOnce({
      currentBytes: 150,
      targetBytes: 100,
      removeFileCount: 2,
      removeBytes: 90,
      candidates: [{ fileName: "stream-old.logseg", bytes: 40 }],
    });

    const result = await defaultWorkspaceApi.planDeviceLogRetention?.(100);

    expect(invoke).toHaveBeenCalledWith("plan_device_log_retention", { targetBytes: 100 });
    expect(result?.removeFileCount).toBe(2);
    expect(result?.candidates[0]?.fileName).toBe("stream-old.logseg");
  });

  it("invokes desktop device log retention apply command", async () => {
    invoke.mockResolvedValueOnce({
      removedFileCount: 2,
      removedBytes: 90,
    });

    const result = await defaultWorkspaceApi.applyDeviceLogRetention?.(100);

    expect(invoke).toHaveBeenCalledWith("apply_device_log_retention", { targetBytes: 100 });
    expect(result?.removedBytes).toBe(90);
  });
});
