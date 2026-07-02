import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

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
    expect(within(panel).getAllByTestId("device-log-entry")).toHaveLength(120);
    expect(within(panel).getByText("300 total · 120 rendered")).toBeVisible();
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
