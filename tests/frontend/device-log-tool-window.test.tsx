import { fireEvent, render, screen, within } from "@testing-library/react";
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
    const panel = await screen.findByLabelText("Device Log Panel");

    await user.click(within(panel).getByRole("checkbox", { name: "Regex" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "(" } });

    expect(await within(panel).findByText(/Invalid regular expression/u)).toBeVisible();
  });
});
