import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

afterEach(() => {
  vi.restoreAllMocks();
});

function createWorkspaceApi(queryDeviceLogs: WorkspaceApi["queryDeviceLogs"]): WorkspaceApi {
  return {
    ...defaultWorkspaceApi,
    listDeviceLogDevices: async () => [{
      id: "device-1",
      label: "Pura 70 - USB",
      status: "online",
      detail: "USB",
    }],
    startDeviceLogStream: async (request) => ({
      streamId: "stream-1",
      deviceId: request.deviceId,
      status: "running",
    }),
    stopDeviceLogStream: async () => undefined,
    queryDeviceLogs,
  };
}

describe("Device Log loaded session", () => {
  it("keeps the initial snapshot loaded while regex filters and backend windows change", async () => {
    const queryDeviceLogs = vi
      .fn()
      .mockResolvedValueOnce(response([makeRow(10, "loaded alpha"), makeRow(11, "loaded beta")]))
      .mockResolvedValueOnce(response([makeRow(10, "loaded alpha")]))
      .mockResolvedValueOnce(response([]));
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await openRunningLogPanel(user);
    const panel = await screen.findByLabelText("Device Log Panel");
    expect(await within(panel).findByLabelText("loaded beta")).toBeVisible();

    await user.click(within(panel).getAllByRole("checkbox", { name: "Regex" })[0]);
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "alpha$" } });
    expect(await within(panel).findByLabelText("loaded alpha")).toBeVisible();
    expect(within(panel).queryByLabelText("loaded beta")).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Clear Log Filters" }));
    expect(await within(panel).findByLabelText("loaded beta")).toBeVisible();
  });

  it("removes both the persisted snapshot and live entries only when the user clears the view", async () => {
    const queryDeviceLogs = vi.fn(async () => response([makeRow(10, "persisted snapshot")]));
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await openRunningLogPanel(user);
    const panel = await screen.findByLabelText("Device Log Panel");
    expect(await within(panel).findByLabelText("persisted snapshot")).toBeVisible();
    fireEvent(panel, new CustomEvent("arkline-device-log-lines", {
      bubbles: true,
      detail: {
        deviceId: "device-1",
        lines: ["06-25 15:21:51.123  1234  5678 I C03F00/AppTag com.example.demo: live session log"],
      },
    }));
    expect(await within(panel).findByLabelText("live session log")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Clear" }));
    expect(within(panel).queryByLabelText("persisted snapshot")).not.toBeInTheDocument();
    expect(within(panel).queryByLabelText("live session log")).not.toBeInTheDocument();
    expect(within(panel).getByText("No log entries")).toBeVisible();
  });

  it("keeps loaded logs visible after the user stops collection", async () => {
    const queryDeviceLogs = vi.fn(async () => response([makeRow(10, "retained after stop")]));
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await openRunningLogPanel(user);
    const panel = await screen.findByLabelText("Device Log Panel");
    expect(await within(panel).findByLabelText("retained after stop")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Stop Device Log Stream" }));
    await waitFor(() => expect(within(panel).queryByText("Running")).not.toBeInTheDocument());
    expect(within(panel).getByLabelText("retained after stop")).toBeVisible();
  });
});

async function openRunningLogPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Device Log" }));
  await user.click(screen.getByRole("tab", { name: "HiLog" }));
  const panel = await screen.findByLabelText("Device Log Panel");
  await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
}

function response(rows: ReturnType<typeof makeRow>[]) {
  return {
    rows,
    totalCandidates: rows.length,
    scannedLines: rows.length,
    truncated: false,
    nextCursorSeq: null,
    budgetExceeded: false,
    queryMs: 2,
  };
}

function makeRow(seq: number, message: string) {
  return {
    seq,
    receivedAtMs: 70_000,
    raw: `06-25 15:21:50.123  1234  5678 I C03F00/AppTag com.example.demo: ${message}`,
    timestamp: "06-25 15:21:50.123",
    level: "info",
    pid: 1234,
    tid: 5678,
    process: "com.example.demo",
    domain: "C03F00",
    tag: "AppTag",
    message,
  };
}
