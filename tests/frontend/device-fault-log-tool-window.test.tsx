import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

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
    listDeviceFaultLogs: async ({ deviceId }) => ({
      deviceId,
      fetchedAt: "2026-06-25T15:21:48.000Z",
      command: `hdc -t ${deviceId} shell faultlog -l`,
      stderr: "",
      status: "ready",
      message: "ok",
      entries: [
        {
          id: "fault-1",
          raw: [
            "Timestamp: 2026-06-25 15:21:48",
            "Reason: JS_ERROR",
            "Process: com.example.demo",
            "PID: 4321",
            "BundleName: com.example.demo",
            "Summary: width is not defined",
            "Stacktrace:",
            "  at render (pages/index.ets:12:3)",
          ].join("\n"),
        },
      ],
    }),
  };
}

describe("Device Fault Log tool window", () => {
  it("refreshes fault logs and renders parsed fault content", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "Fault Log" }));

    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Refresh Fault Logs" }));

    const inspector = await within(panel).findByLabelText("Fault Log Inspector");
    expect(within(inspector).getByText("width is not defined")).toBeVisible();
    expect(within(inspector).getAllByText("com.example.demo")).toHaveLength(2);
  });

  it("resets the fault log view on device change and renders the next device status from store state", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      ...defaultWorkspaceApi,
      listDeviceLogDevices: async () => [
        { id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" },
        { id: "device-2", label: "MatePad - WiFi", status: "unauthorized", detail: "WiFi" },
      ],
      listDeviceFaultLogs: async ({ deviceId }) => {
        if (deviceId === "device-1") {
          return {
            deviceId,
            fetchedAt: "2026-06-25T15:21:48.000Z",
            command: `hdc -t ${deviceId} shell faultlog -l`,
            stderr: "",
            status: "ready",
            message: "ok",
            entries: [
              {
                id: "fault-1",
                raw: [
                  "Timestamp: 2026-06-25 15:21:48",
                  "Reason: JS_ERROR",
                  "Process: com.example.demo",
                  "PID: 4321",
                  "BundleName: com.example.demo",
                  "Summary: width is not defined",
                ].join("\n"),
              },
            ],
          };
        }

        return {
          deviceId,
          fetchedAt: "2026-06-25T15:22:48.000Z",
          command: `hdc -t ${deviceId} shell faultlog -l`,
          stderr: "",
          status: "unauthorized",
          message: "Device unauthorized for fault logs",
          entries: [],
        };
      },
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "Fault Log" }));

    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Refresh Fault Logs" }));
    const firstInspector = await within(panel).findByLabelText("Fault Log Inspector");
    expect(within(firstInspector).getByText("width is not defined")).toBeVisible();

    await user.selectOptions(within(panel).getByRole("combobox", { name: "Device" }), "device-2");
    await waitFor(() => expect(within(panel).queryByText("width is not defined")).not.toBeInTheDocument());
    expect(within(panel).getByText("Refresh fault logs to inspect device faults.")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Refresh Fault Logs" }));
    expect(await within(panel).findAllByText("Device unauthorized for fault logs")).toHaveLength(2);
  });

  it("keeps inspector and copy actions aligned with the visible filtered selection", async () => {
    const user = userEvent.setup();
    const workspaceApi: WorkspaceApi = {
      ...defaultWorkspaceApi,
      listDeviceLogDevices: async () => [
        { id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" },
      ],
      listDeviceFaultLogs: async ({ deviceId }) => ({
        deviceId,
        fetchedAt: "2026-06-25T15:21:48.000Z",
        command: `hdc -t ${deviceId} shell faultlog -l`,
        stderr: "",
        status: "ready",
        message: "ok",
        entries: [
          {
            id: "fault-a",
            raw: [
              "Reason: JS_ERROR",
              "Process: com.example.alpha",
              "PID: 101",
              "BundleName: com.example.alpha",
              "Summary: first visible crash",
            ].join("\n"),
          },
          {
            id: "fault-b",
            raw: [
              "Reason: APP_CRASH",
              "Process: com.example.beta",
              "PID: 202",
              "BundleName: com.example.beta",
              "Summary: second selected crash",
            ].join("\n"),
          },
        ],
      }),
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "Fault Log" }));

    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Refresh Fault Logs" }));
    await user.click(await within(panel).findByRole("button", { name: /second selected crash/u }));

    fireEvent.change(within(panel).getByLabelText("Fault log process"), { target: { value: "alpha" } });

    const inspector = await within(panel).findByLabelText("Fault Log Inspector");
    expect(within(inspector).getByText("first visible crash")).toBeVisible();
    expect(within(panel).queryByRole("button", { name: /second selected crash/u })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Copy Fault Summary" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: "Copy Fault Raw" })).toBeEnabled();
    expect(within(panel).getByRole("button", { name: /first visible crash/u })).toBeVisible();
  });
});
