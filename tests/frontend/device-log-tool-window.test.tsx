import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

afterEach(() => {
  vi.restoreAllMocks();
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createWorkspaceApi(): WorkspaceApi {
  return {
    ...defaultWorkspaceApi,
    listDeviceLogDevices: async () => [
      {
        id: "device-1",
        label: "Pura 70 - USB",
        status: "online",
        detail: "USB",
      },
    ],
    startDeviceLogStream: async (request) => ({
      streamId: "stream-1",
      deviceId: request.deviceId,
      status: "running",
    }),
    stopDeviceLogStream: async () => undefined,
  };
}

describe("Device Log tool window", () => {
  it("opens from the bottom tool tabs and starts a stream for the selected device", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));

    const panel = await screen.findByLabelText("Device Log Panel");
    expect(panel).toBeVisible();
    expect(await within(panel).findByText("Pura 70 - USB")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("Running")).toBeVisible();
  });

  it("shows regex validation errors inline", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    await user.click(within(panel).getByRole("checkbox", { name: "Regex" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "(" } });

    expect(await within(panel).findByText(/Invalid regular expression/u)).toBeVisible();
  });

  it("renders appended raw log lines through the same parser and filter path", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-1",
          lines: ["06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: rendered line"],
        },
      }),
    );

    expect(await within(panel).findByText("rendered line")).toBeVisible();
  });

  it("renders only a bounded tail window during high-throughput streams", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    const lines = Array.from({ length: 300 }, (_, index) => (
      `06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: stream line ${index + 1}`
    ));

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: { deviceId: "device-1", lines },
      }),
    );

    expect(await within(panel).findByText("stream line 300")).toBeVisible();
    expect(within(panel).queryByText("stream line 1")).not.toBeInTheDocument();
    const renderedRows = within(panel).getAllByTestId("device-log-entry");
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(300);
    expect(within(panel).getByText(/300 total · 300 matched · \d+ rendered/u)).toBeVisible();
  });

  it("caps the live log window and reports older persisted lines", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    const lines = Array.from({ length: 10_050 }, (_, index) => (
      `06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: load line ${index + 1}`
    ));

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: { deviceId: "device-1", lines },
      }),
    );

    expect(await within(panel).findByText("load line 10050")).toBeVisible();
    expect(within(panel).queryByLabelText("load line 1")).not.toBeInTheDocument();
    expect(within(panel).getByText(/10,000 live · 50 older persisted · \d+ rendered/u)).toBeVisible();
  });

  it("filters text queries against the most recent one-minute log window", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(10_000);
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-1",
          lines: ["06-25 15:20:48.123  1234  5678 I C03F00/AppTag com.example.demo: old width log"],
        },
      }),
    );
    expect(await within(panel).findByText("old width log")).toBeVisible();

    nowSpy.mockReturnValue(70_001);
    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-1",
          lines: ["06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: fresh width log"],
        },
      }),
    );

    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });

    expect(await within(panel).findByLabelText("fresh width log")).toBeVisible();
    expect(within(panel).queryByText("old width log")).not.toBeInTheDocument();
    nowSpy.mockRestore();
  });

  it("queries the backend recent log window while a stream is running, even without a filter", async () => {
    const queryDeviceLogs = vi.fn(async () => ({
      rows: [{
        seq: 12,
        receivedAtMs: 70_000,
        raw: "06-25 15:21:48.123  1234  5678 E C03F00/AppTag com.example.demo: backend width log",
        timestamp: "06-25 15:21:48.123",
        level: "error",
        pid: 1234,
        tid: 5678,
        process: "com.example.demo",
        domain: "C03F00",
        tag: "AppTag",
        message: "backend width log",
      }],
      totalCandidates: 1200,
      scannedLines: 34,
      truncated: false,
      nextCursorSeq: null,
      budgetExceeded: false,
      queryMs: 7,
    }));
    const user = userEvent.setup();
    render(<AppShell workspaceApi={{ ...createWorkspaceApi(), queryDeviceLogs }} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));

    expect(await within(panel).findByLabelText("backend width log")).toBeVisible();
    expect(queryDeviceLogs).toHaveBeenCalledWith(expect.objectContaining({
      streamId: "stream-1",
      query: "",
      timeRangeMs: 60_000,
    }));
    expect(within(panel).getByText(/1,200 candidates · 34 scanned · 7ms/u)).toBeVisible();

    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });
    await waitFor(() => expect(queryDeviceLogs).toHaveBeenCalledWith(expect.objectContaining({ query: "width" })));
    expect(within(panel).getAllByText("width").some((node) => node.tagName.toLowerCase() === "mark")).toBe(true);
  });

  it("opens a log inspector and can filter by the selected row tag", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-1",
          lines: [
            "06-25 15:21:48.123  1234  5678 E C03F00/AppTag com.example.demo: inspected failure",
            "06-25 15:21:49.123  1234  5678 I C03F00/OtherTag com.example.demo: other message",
          ],
        },
      }),
    );

    expect(await within(panel).findByLabelText("other message")).toBeVisible();
    await user.click(await within(panel).findByLabelText("inspected failure"));

    const inspector = within(panel).getByRole("region", { name: "Log Inspector" });
    expect(within(inspector).getByText("com.example.demo")).toBeVisible();
    expect(within(inspector).getByText(/inspected failure/u)).toBeVisible();

    await user.click(within(inspector).getByRole("button", { name: "Filter Tag" }));
    await waitFor(() => expect(within(panel).queryByLabelText("other message")).not.toBeInTheDocument());
    expect(within(panel).getByLabelText("inspected failure")).toBeVisible();
  });

  it("shows running stream persistence stats from the backend", async () => {
    const getDeviceLogStats = vi.fn(async () => ({
      streamId: "stream-1",
      deviceId: "device-1",
      streamStatus: "running" as const,
      ingestedLines: 1200,
      persistedLines: 1200,
      droppedLines: 0,
      pendingBatches: 0,
      bufferBytes: 4096,
      lastWriteMs: 0,
      slowWriteBatches: 0,
      backpressureState: "idle",
      lastError: null,
    }));
    const user = userEvent.setup();
    render(<AppShell workspaceApi={{ ...createWorkspaceApi(), getDeviceLogStats }} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));

    expect(await within(panel).findByText("running · 1,200 lines · 4 KiB persisted · 0 dropped · idle")).toBeVisible();
    expect(getDeviceLogStats).toHaveBeenCalledWith("stream-1");
  });

  it("keeps the stream across tab switches and stops and clears it on device change", async () => {
    const stopDeviceLogStream = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      ...defaultWorkspaceApi,
      listDeviceLogDevices: async () => [
        { id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" },
        { id: "device-2", label: "MatePad - WiFi", status: "online", detail: "WiFi" },
      ],
      startDeviceLogStream: async ({ deviceId }) => ({
        streamId: `stream-${deviceId}`,
        deviceId,
        status: "running",
      }),
      stopDeviceLogStream,
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("Running")).toBeVisible();

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-1",
          lines: ["06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: first device line"],
        },
      }),
    );
    expect(await within(panel).findByText("first device line")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Fault Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    expect(within(panel).getByRole("button", { name: "Stop Device Log Stream" })).toBeVisible();

    await user.selectOptions(within(panel).getByRole("combobox", { name: "Device" }), "device-2");

    await waitFor(() => expect(stopDeviceLogStream).toHaveBeenCalledWith("stream-device-1"));
    await waitFor(() => expect(within(panel).queryByText("first device line")).not.toBeInTheDocument());

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-1",
          lines: ["06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: ignored old device line"],
        },
      }),
    );
    expect(within(panel).queryByText("ignored old device line")).not.toBeInTheDocument();

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-2",
          lines: ["06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: second device line"],
        },
      }),
    );
    expect(await within(panel).findByText("second device line")).toBeVisible();
  });

  it("ignores a stale start-stream result after switching devices", async () => {
    const firstStart = createDeferred<{ streamId: string; deviceId: string; status: "running" }>();
    const stopDeviceLogStream = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      ...defaultWorkspaceApi,
      listDeviceLogDevices: async () => [
        { id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" },
        { id: "device-2", label: "MatePad - WiFi", status: "online", detail: "WiFi" },
      ],
      startDeviceLogStream: vi.fn(async ({ deviceId }) => {
        if (deviceId === "device-1") {
          return firstStart.promise;
        }

        return { streamId: `stream-${deviceId}`, deviceId, status: "running" as const };
      }),
      stopDeviceLogStream,
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Device" }), "device-2");

    firstStart.resolve({ streamId: "stream-device-1", deviceId: "device-1", status: "running" });

    await waitFor(() => expect(stopDeviceLogStream).toHaveBeenCalledWith("stream-device-1"));
    await waitFor(() => expect(within(panel).queryByText("Running")).not.toBeInTheDocument());
    expect(within(panel).getByText("idle")).toBeVisible();
  });

  it("recovers to a usable running state when stop stream fails", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      ...defaultWorkspaceApi,
      listDeviceLogDevices: async () => [
        { id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" },
      ],
      startDeviceLogStream: async ({ deviceId }) => ({
        streamId: `stream-${deviceId}`,
        deviceId,
        status: "running",
      }),
      stopDeviceLogStream: async () => {
        throw new Error("Stop device log stream failed");
      },
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("Running")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Stop Device Log Stream" }));

    await waitFor(() => expect(within(panel).queryByText("stopping")).not.toBeInTheDocument());
    expect(within(panel).getByText("Running")).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Stop Device Log Stream" })).toBeVisible();
    expect(within(panel).getByText("Stop device log stream failed")).toBeVisible();
  });

  it("does not let hidden fault log reset overwrite the visible hilog shared status", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      ...defaultWorkspaceApi,
      listDeviceLogDevices: async () => [
        { id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" },
        { id: "device-2", label: "MatePad - WiFi", status: "online", detail: "WiFi" },
      ],
      startDeviceLogStream: async ({ deviceId }) => ({
        streamId: `stream-${deviceId}`,
        deviceId,
        status: "running",
      }),
      stopDeviceLogStream: async () => undefined,
      listDeviceFaultLogs: async ({ deviceId }) => ({
        deviceId,
        fetchedAt: "2026-06-25T15:21:48.000Z",
        command: `hdc -t ${deviceId} shell faultlog -l`,
        stderr: "",
        status: "ready",
        message: "fault logs ready",
        entries: [],
      }),
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("Device log stream running")).toBeVisible();

    await user.selectOptions(within(panel).getByRole("combobox", { name: "Device" }), "device-2");

    await waitFor(() => expect(within(panel).queryByText("Fault log view idle")).not.toBeInTheDocument());
    expect(within(panel).getByText("Device log stream stopped")).toBeVisible();
  });
});
