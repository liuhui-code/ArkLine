import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("Device Log inspector actions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("copies the selected raw line from the inspector", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    const raw = "06-25 15:21:48.123  1234  5678 E C03F00/AppTag com.example.demo: inspected failure";
    fireEvent(panel, new CustomEvent("arkline-device-log-lines", {
      bubbles: true,
      detail: { deviceId: "device-1", lines: [raw] },
    }));

    await user.click(await within(panel).findByLabelText("inspected failure"));
    await user.click(within(panel).getByRole("button", { name: "Copy Raw Log" }));

    expect(writeText).toHaveBeenCalledWith(raw);
    expect(within(panel).getByText("Raw copied")).toBeVisible();
  });

  it("filters by the selected row pid from the inspector", async () => {
    const user = userEvent.setup();
    const queryDeviceLogs = vi.fn(async () => ({
      rows: [],
      totalCandidates: 0,
      scannedLines: 0,
      truncated: false,
      nextCursorSeq: null,
      budgetExceeded: false,
      queryMs: 1,
    }));
    render(<AppShell workspaceApi={createWorkspaceApi({ queryDeviceLogs })} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent(panel, new CustomEvent("arkline-device-log-lines", {
      bubbles: true,
      detail: {
        deviceId: "device-1",
        lines: ["06-25 15:21:48.123  1234  5678 E C03F00/AppTag com.example.demo: inspected failure"],
      },
    }));

    await user.click(await within(panel).findByLabelText("inspected failure"));
    queryDeviceLogs.mockClear();
    await user.click(within(panel).getByRole("button", { name: "Filter PID" }));

    expect(within(panel).getByLabelText("Filter log pid")).toHaveValue("1234");
    await waitFor(() => expect(queryDeviceLogs).toHaveBeenLastCalledWith(expect.objectContaining({
      pid: "1234",
      streamId: "stream-1",
    })));
  });

  it("filters by the selected row domain from the inspector", async () => {
    const user = userEvent.setup();
    const queryDeviceLogs = vi.fn(async () => ({
      rows: [],
      totalCandidates: 0,
      scannedLines: 0,
      truncated: false,
      nextCursorSeq: null,
      budgetExceeded: false,
      queryMs: 1,
    }));
    render(<AppShell workspaceApi={createWorkspaceApi({ queryDeviceLogs })} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent(panel, new CustomEvent("arkline-device-log-lines", {
      bubbles: true,
      detail: {
        deviceId: "device-1",
        lines: ["06-25 15:21:48.123  1234  5678 E C03F00/AppTag com.example.demo: inspected failure"],
      },
    }));

    await user.click(await within(panel).findByLabelText("inspected failure"));
    queryDeviceLogs.mockClear();
    await user.click(within(panel).getByRole("button", { name: "Filter Domain" }));

    expect(within(panel).getByLabelText("Filter log domain")).toHaveValue("C03F00");
    await waitFor(() => expect(queryDeviceLogs).toHaveBeenLastCalledWith(expect.objectContaining({
      domain: "C03F00",
      streamId: "stream-1",
    })));
  });
});
