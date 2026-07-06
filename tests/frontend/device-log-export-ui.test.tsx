import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    ...defaultWorkspaceApi,
    listDeviceLogDevices: async () => [
      { id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" },
    ],
    startDeviceLogStream: async (request) => ({
      streamId: "stream-1",
      deviceId: request.deviceId,
      status: "running",
    }),
    stopDeviceLogStream: async () => undefined,
    ...overrides,
  };
}

describe("Device Log export", () => {
  it("exports the current filtered stream to a selected file path", async () => {
    const user = userEvent.setup();
    const pickSaveFile = vi.fn(async () => "/tmp/arkline-hilog.log");
    const exportDeviceLogsToFile = vi.fn(async () => undefined);
    render(<AppShell workspaceApi={createWorkspaceApi({ pickSaveFile, exportDeviceLogsToFile })} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "fault" } });

    await user.click(within(panel).getByRole("button", { name: "Export Filtered Logs" }));

    expect(pickSaveFile).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "arkline-hilog-device-1.log",
      title: "Export Device Logs",
    }));
    await waitFor(() => expect(exportDeviceLogsToFile).toHaveBeenCalledWith(
      expect.objectContaining({ streamId: "stream-1", query: "fault", timeRangeMs: 60_000 }),
      "/tmp/arkline-hilog.log",
    ));
    expect(await within(panel).findByText("Device logs exported")).toBeVisible();
  });

  it("does not export when the save dialog is cancelled", async () => {
    const user = userEvent.setup();
    const pickSaveFile = vi.fn(async () => null);
    const exportDeviceLogsToFile = vi.fn(async () => undefined);
    render(<AppShell workspaceApi={createWorkspaceApi({ pickSaveFile, exportDeviceLogsToFile })} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));

    await user.click(within(panel).getByRole("button", { name: "Export Filtered Logs" }));

    expect(exportDeviceLogsToFile).not.toHaveBeenCalled();
    expect(await within(panel).findByText("Device log export cancelled")).toBeVisible();
  });
});
