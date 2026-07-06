import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

const save = vi.hoisted(() => vi.fn(async (): Promise<string | null> => "/tmp/export.log"));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("workspace save dialog api", () => {
  beforeEach(() => {
    save.mockClear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("picks a save file path through the Tauri dialog plugin", async () => {
    const selected = await defaultWorkspaceApi.pickSaveFile?.({
      defaultPath: "arkline-hilog-device-1.log",
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
      title: "Export Device Logs",
    });

    expect(selected).toBe("/tmp/export.log");
    expect(save).toHaveBeenCalledWith({
      defaultPath: "arkline-hilog-device-1.log",
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
      title: "Export Device Logs",
    });
  });
});
