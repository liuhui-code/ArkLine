import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("Device Log structured filters", () => {
  it("queries the backend when only a log level filter is selected", async () => {
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
    queryDeviceLogs.mockClear();

    await user.click(within(panel).getByRole("button", { name: "Error Logs" }));

    await waitFor(() => expect(queryDeviceLogs).toHaveBeenCalledWith(expect.objectContaining({
      levels: ["error"],
      query: "",
      streamId: "stream-1",
    })));
  });

  it("queries the backend from structured process and tag filters without text search", async () => {
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
    queryDeviceLogs.mockClear();

    await user.type(within(panel).getByLabelText("Filter log process"), "camera");
    await user.type(within(panel).getByLabelText("Filter log tag"), "Ability");

    await waitFor(() => expect(queryDeviceLogs).toHaveBeenLastCalledWith(expect.objectContaining({
      process: "camera",
      tag: "Ability",
      query: "",
      streamId: "stream-1",
    })));
  });

  it("queries the backend from pid filters and can clear active filters", async () => {
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
    queryDeviceLogs.mockClear();

    await user.type(within(panel).getByLabelText("Filter log pid"), "1234");

    await waitFor(() => expect(queryDeviceLogs).toHaveBeenLastCalledWith(expect.objectContaining({
      pid: "1234",
      query: "",
      streamId: "stream-1",
    })));

    await user.click(within(panel).getByRole("button", { name: "Clear Log Filters" }));

    expect(within(panel).getByLabelText("Filter log pid")).toHaveValue("");
  });

  it("blocks backend queries while the pid filter is invalid", async () => {
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
    queryDeviceLogs.mockClear();

    await user.type(within(panel).getByLabelText("Filter log pid"), "12x");

    expect(await within(panel).findByText("PID filter must be a number")).toBeVisible();
    expect(queryDeviceLogs).not.toHaveBeenCalled();
  });
});
