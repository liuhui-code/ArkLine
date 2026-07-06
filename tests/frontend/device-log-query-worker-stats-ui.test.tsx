import { render, screen } from "@testing-library/react";
import { DeviceHiLogPanel } from "@/components/layout/DeviceHiLogPanel";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

describe("Device Log query worker stats UI", () => {
  it("shows foreground query worker pressure in the toolbar", async () => {
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={{
          ...defaultWorkspaceApi,
          getDeviceLogQueryWorkerStats: async () => ({
            running: true,
            queued: 1,
            completedQueries: 4,
            cancelledQueries: 2,
            failedQueries: 0,
            lastQueryMs: 17,
            lastError: null,
          }),
        }}
        onStatusChange={() => undefined}
      />,
    );

    expect(await screen.findByText("Query running · 1 queued · 2 cancelled · last 17ms")).toBeVisible();
  });

  it("shows recent foreground query worker events for diagnostics", async () => {
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={{
          ...defaultWorkspaceApi,
          getDeviceLogQueryWorkerEvents: async () => [{
            sequence: 3,
            streamId: "stream-1",
            query: "width",
            status: "failed",
            durationMs: 42,
            error: "regex too broad",
          }],
        }}
        onStatusChange={() => undefined}
      />,
    );

    const diagnostics = await screen.findByRole("region", { name: "Query Diagnostics" });

    expect(diagnostics).toHaveTextContent("width");
    expect(diagnostics).toHaveTextContent("failed");
    expect(diagnostics).toHaveTextContent("42ms");
    expect(diagnostics).toHaveTextContent("regex too broad");
  });

  it("summarizes failed cancelled and slow query worker events", async () => {
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={{
          ...defaultWorkspaceApi,
          getDeviceLogQueryWorkerEvents: async () => [
            { sequence: 1, streamId: "stream-1", query: "ok", status: "completed", durationMs: 20, error: null },
            { sequence: 2, streamId: "stream-1", query: "slow", status: "completed", durationMs: 320, error: null },
            { sequence: 3, streamId: "stream-1", query: "cancelled", status: "cancelled", durationMs: 18, error: null },
            { sequence: 4, streamId: "stream-1", query: "failed", status: "failed", durationMs: 12, error: "bad regex" },
          ],
        }}
        onStatusChange={() => undefined}
      />,
    );

    const diagnostics = await screen.findByRole("region", { name: "Query Diagnostics" });

    expect(diagnostics).toHaveTextContent("1 failed");
    expect(diagnostics).toHaveTextContent("1 cancelled");
    expect(diagnostics).toHaveTextContent("1 slow");
  });
});
