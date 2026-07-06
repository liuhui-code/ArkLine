import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeviceHiLogPanel } from "@/components/layout/DeviceHiLogPanel";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

function createWorkspaceApi(): WorkspaceApi {
  return {
    ...defaultWorkspaceApi,
    getDeviceLogStorageHealth: async () => ({
      rootPath: "/tmp/arkline-device-logs",
      totalBytes: 3 * 1024 * 1024 * 1024,
      segmentFileCount: 1,
      segmentBytes: 3 * 1024 * 1024 * 1024,
      metadataBytes: 0,
      metadataBatchCount: 1,
      metadataLineCount: 100,
      oldestReceivedAtMs: 10_000,
      newestReceivedAtMs: 20_000,
      pressureState: "critical",
      recommendedAction: "clearOldLogs",
    }),
    clearDeviceLogStorage: async () => ({
      removedFileCount: 2,
      removedBytes: 4096,
    }),
    applyDeviceLogRetention: async () => ({
      removedFileCount: 3,
      removedBytes: 1024 * 1024,
    }),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("Device Log storage health UI", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows storage pressure and clears persisted logs on demand", async () => {
    const user = userEvent.setup();
    const clearDeviceLogStorage = vi.fn(createWorkspaceApi().clearDeviceLogStorage);
    const onStatusChange = vi.fn();
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={{ ...createWorkspaceApi(), clearDeviceLogStorage }}
        onStatusChange={onStatusChange}
      />,
    );

    expect(await screen.findByText("Storage critical · 3 GiB")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear Device Log Storage" }));

    expect(clearDeviceLogStorage).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Device log storage cleared: 2 files");
    expect(within(screen.getByRole("button", { name: "Clear Device Log Storage" })).getByText("Clear Storage")).toBeVisible();
  });

  it("applies retention when persisted storage is over budget", async () => {
    const user = userEvent.setup();
    const applyDeviceLogRetention = vi.fn(createWorkspaceApi().applyDeviceLogRetention);
    const onStatusChange = vi.fn();
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={{ ...createWorkspaceApi(), applyDeviceLogRetention }}
        onStatusChange={onStatusChange}
      />,
    );

    expect(await screen.findByText("Storage critical · 3 GiB")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Apply Device Log Retention" }));

    expect(applyDeviceLogRetention).toHaveBeenCalledWith(512 * 1024 * 1024);
    expect(onStatusChange).toHaveBeenCalledWith("Device log retention applied: 3 files");
  });

  it("refreshes storage pressure while the panel stays active", async () => {
    vi.useFakeTimers();
    const getDeviceLogStorageHealth = vi
      .fn()
      .mockResolvedValueOnce({
        ...await createWorkspaceApi().getDeviceLogStorageHealth!(),
        totalBytes: 1024,
        pressureState: "healthy",
        recommendedAction: "none",
      })
      .mockResolvedValueOnce(await createWorkspaceApi().getDeviceLogStorageHealth!());
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={{ ...createWorkspaceApi(), getDeviceLogStorageHealth }}
        onStatusChange={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Storage healthy · 1 KiB")).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(getDeviceLogStorageHealth).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Storage critical · 3 GiB")).toBeVisible();
  });

  it("does not overlap storage health refreshes when a request is still running", async () => {
    vi.useFakeTimers();
    const pendingHealth = createDeferred<Awaited<ReturnType<NonNullable<WorkspaceApi["getDeviceLogStorageHealth"]>>>>();
    const getDeviceLogStorageHealth = vi.fn(() => pendingHealth.promise);
    render(
      <DeviceHiLogPanel
        active
        deviceId="device-1"
        workspaceApi={{ ...createWorkspaceApi(), getDeviceLogStorageHealth }}
        onStatusChange={vi.fn()}
      />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });

    expect(getDeviceLogStorageHealth).toHaveBeenCalledTimes(1);
  });
});
