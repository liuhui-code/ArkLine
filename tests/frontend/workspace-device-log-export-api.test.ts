import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

describe("workspace device log export api", () => {
  beforeEach(() => {
    invoke.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("invokes the desktop command for direct file export", async () => {
    const request = {
      streamId: "stream-1",
      query: "fault",
      regex: false,
      matchCase: false,
      levels: [],
      pid: "",
      process: "",
      domain: "",
      tag: "",
      timeRangeMs: 60_000,
      limit: 500,
      cursorSeq: null,
      scanBudgetLines: 100_000,
    };

    await defaultWorkspaceApi.exportDeviceLogsToFile?.(request, "/tmp/device.log");

    expect(invoke).toHaveBeenCalledWith("export_device_logs_to_file", {
      request,
      path: "/tmp/device.log",
    });
  });
});
