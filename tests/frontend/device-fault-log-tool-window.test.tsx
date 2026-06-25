import { render, screen, within } from "@testing-library/react";
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
});
