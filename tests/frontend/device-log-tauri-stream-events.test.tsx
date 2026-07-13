import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceHiLogPanel } from "@/components/layout/DeviceHiLogPanel";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";
import { listen } from "@tauri-apps/api/event";

type DeviceLogOutputPayload = {
  streamId: string;
  deviceId: string;
  lines: string[];
};

let deviceLogOutputHandler: ((event: { payload: DeviceLogOutputPayload }) => void) | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (eventName: string, handler: (event: { payload: DeviceLogOutputPayload }) => void) => {
    if (eventName === "device-log-output") {
      deviceLogOutputHandler = handler;
    }
    return vi.fn();
  }),
}));

afterEach(() => {
  deviceLogOutputHandler = null;
  vi.restoreAllMocks();
});

describe("DeviceHiLogPanel Tauri stream events", () => {
  it("renders backend log output events when Tauri internals marker is absent", async () => {
    const user = userEvent.setup();
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={workspaceApi()}
        onStatusChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start Device Log Stream" }));

    expect(listen).toHaveBeenCalledWith("device-log-output", expect.any(Function));
    deviceLogOutputHandler?.({
      payload: {
        streamId: "stream-1",
        deviceId: "device-1",
        lines: ["06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: tauri stream line"],
      },
    });

    const entries = screen.getByRole("log", { name: "Device Log Entries" });
    await waitFor(() => expect(within(entries).getByText("tauri stream line")).toBeVisible());
  });
});

function workspaceApi(): WorkspaceApi {
  return {
    ...defaultWorkspaceApi,
    startDeviceLogStream: async ({ deviceId }) => ({
      streamId: "stream-1",
      deviceId,
      status: "running",
    }),
    stopDeviceLogStream: async () => undefined,
  };
}
