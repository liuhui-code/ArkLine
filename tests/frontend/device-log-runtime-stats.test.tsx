import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { DeviceHiLogPanel } from "@/components/layout/DeviceHiLogPanel";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

function createWorkspaceApi(): WorkspaceApi {
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
    getDeviceLogStats: async () => ({
      streamId: "stream-1",
      deviceId: "device-1",
      streamStatus: "running",
      ingestedLines: 20_000,
      persistedLines: 19_800,
      droppedLines: 0,
      pendingBatches: 42,
      bufferBytes: 1_048_576,
      lastWriteMs: 12,
      slowWriteBatches: 3,
      warnLines: 5,
      errorLines: 2,
      fatalLines: 1,
      backpressureState: "saturated",
      lastError: null,
    }),
  };
}

describe("Device Log runtime stats", () => {
  it("shows pending batch pressure without reporting dropped lines", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));

    expect(await within(panel).findByText(/running · 20,000 lines · E2 · W5 · F1 · 1 MiB persisted · 0 dropped · 42 pending · write 12ms · 3 slow · saturated/u)).toBeVisible();
  });

  it("switches the stream control to error when backend stats report a failed stream", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={{
      ...createWorkspaceApi(),
      getDeviceLogStats: async () => ({
        streamId: "stream-1",
        deviceId: "device-1",
        streamStatus: "error",
        ingestedLines: 12,
        persistedLines: 12,
        droppedLines: 0,
        pendingBatches: 0,
        bufferBytes: 2048,
        lastWriteMs: 0,
        slowWriteBatches: 0,
        backpressureState: "idle",
        lastError: "hdc disconnected",
      }),
    }} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));

    expect(await within(panel).findByText("error")).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Retry Device Log Stream" })).toBeVisible();
    expect(within(panel).getAllByText(/hdc disconnected/u).length).toBeGreaterThan(0);
    expect(within(panel).queryByRole("button", { name: "Stop Device Log Stream" })).not.toBeInTheDocument();
  });

  it("shows a recoverable error when runtime stats polling fails", async () => {
    const onStatusChange = vi.fn();
    const stopDeviceLogStream = vi.fn(async () => undefined);
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        retryDelaysMs={[60_000]}
        workspaceApi={{
          ...createWorkspaceApi(),
          getDeviceLogStats: async () => {
            throw new Error("stats backend unavailable");
          },
          stopDeviceLogStream,
        }}
        onStatusChange={onStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Device Log Stream" }));

    expect(await screen.findByText("error")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Retry Device Log Stream" })).toBeVisible();
    expect(screen.getAllByText(/stats backend unavailable/u).length).toBeGreaterThan(0);
    expect(onStatusChange).toHaveBeenCalledWith("stats backend unavailable");
    expect(stopDeviceLogStream).toHaveBeenCalledWith("stream-1");
  });

  it("retries the stream after a backend error without reusing stale error stats", async () => {
    const user = userEvent.setup();
    const startDeviceLogStream = vi.fn(async (request: { deviceId: string }) => ({
      streamId: `stream-${startDeviceLogStream.mock.calls.length}`,
      deviceId: request.deviceId,
      status: "running" as const,
    }));
    const getDeviceLogStats = vi
      .fn()
      .mockResolvedValueOnce({
        streamId: "stream-1",
        deviceId: "device-1",
        streamStatus: "error",
        ingestedLines: 12,
        persistedLines: 12,
        droppedLines: 0,
        pendingBatches: 0,
        bufferBytes: 2048,
        lastWriteMs: 0,
        slowWriteBatches: 0,
        backpressureState: "idle",
        lastError: "hdc disconnected",
      })
      .mockResolvedValue({
        streamId: "stream-2",
        deviceId: "device-1",
        streamStatus: "running",
        ingestedLines: 0,
        persistedLines: 0,
        droppedLines: 0,
        pendingBatches: 0,
        bufferBytes: 0,
        lastWriteMs: 0,
        slowWriteBatches: 0,
        backpressureState: "idle",
        lastError: null,
      });

    render(<AppShell workspaceApi={{ ...createWorkspaceApi(), startDeviceLogStream, getDeviceLogStats }} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("error")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Retry Device Log Stream" }));

    expect(startDeviceLogStream).toHaveBeenCalledTimes(2);
    expect(await within(panel).findByText("Running")).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Stop Device Log Stream" })).toBeVisible();
    expect(within(panel).queryByText("error")).not.toBeInTheDocument();
  });

  it("automatically retries a failed stream after a short visible countdown", async () => {
    const user = userEvent.setup();
    const startDeviceLogStream = vi.fn(async (request: { deviceId: string }) => ({
      streamId: `stream-${startDeviceLogStream.mock.calls.length}`,
      deviceId: request.deviceId,
      status: "running" as const,
    }));
    const getDeviceLogStats = vi
      .fn()
      .mockResolvedValueOnce({
        streamId: "stream-1",
        deviceId: "device-1",
        streamStatus: "error",
        ingestedLines: 12,
        persistedLines: 12,
        droppedLines: 0,
        pendingBatches: 0,
        bufferBytes: 2048,
        lastWriteMs: 0,
        slowWriteBatches: 0,
        backpressureState: "idle",
        lastError: "hdc disconnected",
      })
      .mockResolvedValue({
        streamId: "stream-2",
        deviceId: "device-1",
        streamStatus: "running",
        ingestedLines: 0,
        persistedLines: 0,
        droppedLines: 0,
        pendingBatches: 0,
        bufferBytes: 0,
        lastWriteMs: 0,
        slowWriteBatches: 0,
        backpressureState: "idle",
        lastError: null,
      });

    render(<AppShell workspaceApi={{ ...createWorkspaceApi(), startDeviceLogStream, getDeviceLogStats }} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("error")).toBeVisible();
    expect(within(panel).getByText("Auto retry in 2s")).toBeVisible();

    await waitFor(() => expect(startDeviceLogStream).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    expect(await within(panel).findByText("Running")).toBeVisible();
    expect(within(panel).queryByText(/Auto retry/u)).not.toBeInTheDocument();
  });

  it("backs off the visible auto retry delay after consecutive stream failures", async () => {
    const user = userEvent.setup();
    const startDeviceLogStream = vi.fn(async (request: { deviceId: string }) => ({
      streamId: `stream-${startDeviceLogStream.mock.calls.length}`,
      deviceId: request.deviceId,
      status: "running" as const,
    }));
    const errorStats = {
      streamId: "stream-1",
      deviceId: "device-1",
      streamStatus: "error",
      ingestedLines: 12,
      persistedLines: 12,
      droppedLines: 0,
      pendingBatches: 0,
      bufferBytes: 2048,
      lastWriteMs: 0,
      slowWriteBatches: 0,
      backpressureState: "idle",
      lastError: "hdc disconnected",
    };
    const getDeviceLogStats = vi
      .fn()
      .mockResolvedValueOnce(errorStats)
      .mockResolvedValueOnce({ ...errorStats, streamId: "stream-2" });

    render(<AppShell workspaceApi={{ ...createWorkspaceApi(), startDeviceLogStream, getDeviceLogStats }} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("Auto retry in 2s")).toBeVisible();

    await waitFor(() => expect(startDeviceLogStream).toHaveBeenCalledTimes(2), { timeout: 3_000 });

    expect(await within(panel).findByText("Auto retry in 4s")).toBeVisible();
  });

  it("shows retry exhaustion and waits for manual retry after the retry budget is spent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args) => {
      if (String(args[0]).includes("not wrapped in act")) {
        return;
      }
      process.stderr.write(`${args.join(" ")}\n`);
    });
    const startDeviceLogStream = vi.fn(async (request: { deviceId: string }) => ({
      streamId: `stream-${startDeviceLogStream.mock.calls.length}`,
      deviceId: request.deviceId,
      status: "running" as const,
    }));
    const getDeviceLogStats = vi.fn(async () => ({
      streamId: `stream-${startDeviceLogStream.mock.calls.length}`,
      deviceId: "device-1",
      streamStatus: "error" as const,
      ingestedLines: 12,
      persistedLines: 12,
      droppedLines: 0,
      pendingBatches: 0,
      bufferBytes: 2048,
      lastWriteMs: 0,
      slowWriteBatches: 0,
      backpressureState: "idle",
      lastError: "hdc disconnected",
    }));

    try {
      render(
        <DeviceHiLogPanel
          active
          deviceId="device-1"
          retryDelaysMs={[1, 2, 3]}
          workspaceApi={{ ...createWorkspaceApi(), startDeviceLogStream, getDeviceLogStats }}
          onStatusChange={() => undefined}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Start Device Log Stream" }));

      await waitFor(() => expect(startDeviceLogStream).toHaveBeenCalledTimes(2), { timeout: 500 });
      await waitFor(() => expect(startDeviceLogStream).toHaveBeenCalledTimes(3), { timeout: 500 });
      await waitFor(() => expect(startDeviceLogStream).toHaveBeenCalledTimes(4), { timeout: 500 });
      expect(await screen.findByText("Auto retry stopped")).toBeVisible();

      await new Promise((resolve) => window.setTimeout(resolve, 20));
      expect(startDeviceLogStream).toHaveBeenCalledTimes(4);

      fireEvent.click(screen.getByRole("button", { name: "Retry Device Log Stream" }));

      await waitFor(() => expect(startDeviceLogStream).toHaveBeenCalledTimes(5));
    } finally {
      consoleError.mockRestore();
    }
  });

  it("lets the user pause and resume automatic retries from the log toolbar", async () => {
    const startDeviceLogStream = vi.fn(async (request: { deviceId: string }) => ({
      streamId: `stream-${startDeviceLogStream.mock.calls.length}`,
      deviceId: request.deviceId,
      status: "running" as const,
    }));
    const getDeviceLogStats = vi.fn(async () => ({
      streamId: "stream-1",
      deviceId: "device-1",
      streamStatus: "error" as const,
      ingestedLines: 12,
      persistedLines: 12,
      droppedLines: 0,
      pendingBatches: 0,
      bufferBytes: 2048,
      lastWriteMs: 0,
      slowWriteBatches: 0,
      backpressureState: "idle",
      lastError: "hdc disconnected",
    }));

    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        retryDelaysMs={[60_000]}
        workspaceApi={{ ...createWorkspaceApi(), startDeviceLogStream, getDeviceLogStats }}
        onStatusChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Device Log Stream" }));
    await waitFor(() => expect(screen.getByText("Auto retry in 60s")).toBeVisible());

    fireEvent.click(screen.getByRole("button", { name: "Pause Device Log Auto Retry" }));

    expect(screen.getByText("Auto retry paused")).toBeVisible();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(startDeviceLogStream).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Resume Device Log Auto Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry Device Log Stream" }));

    await waitFor(() => expect(startDeviceLogStream).toHaveBeenCalledTimes(2));
  });
});
