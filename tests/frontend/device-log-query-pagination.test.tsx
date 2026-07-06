import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

describe("Device Log query pagination", () => {
  it("coalesces filter changes while a backend query is still running", async () => {
    const firstQuery = createDeferred<Awaited<ReturnType<NonNullable<WorkspaceApi["queryDeviceLogs"]>>>>();
    const queryDeviceLogs = vi.fn(async (request) => {
      if (request.query === "width") {
        return firstQuery.promise;
      }
      return {
        rows: [makeRow(20, "latest height log")],
        totalCandidates: 1,
        scannedLines: 1,
        truncated: false,
        nextCursorSeq: null,
        budgetExceeded: false,
        queryMs: 3,
      };
    });
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    expect(queryDeviceLogs).toHaveBeenCalledTimes(1);

    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "height" } });
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    expect(queryDeviceLogs).toHaveBeenCalledTimes(1);

    act(() => {
      firstQuery.resolve({
        rows: [makeRow(10, "stale width log")],
        totalCandidates: 1,
        scannedLines: 1,
        truncated: false,
        nextCursorSeq: null,
        budgetExceeded: false,
        queryMs: 30,
      });
    });

    expect(await within(panel).findByLabelText("latest height log")).toBeVisible();
    expect(queryDeviceLogs).toHaveBeenLastCalledWith(expect.objectContaining({ query: "height" }));
    expect(within(panel).queryByLabelText("stale width log")).not.toBeInTheDocument();
  });

  it("shows a searching state while the backend query is still running", async () => {
    const firstQuery = createDeferred<Awaited<ReturnType<NonNullable<WorkspaceApi["queryDeviceLogs"]>>>>();
    const queryDeviceLogs = vi.fn(async () => firstQuery.promise);
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });

    expect(await within(panel).findByText("Searching logs...")).toBeVisible();

    act(() => {
      firstQuery.resolve({
        rows: [makeRow(10, "resolved width log")],
        totalCandidates: 1,
        scannedLines: 1,
        truncated: false,
        nextCursorSeq: null,
        budgetExceeded: false,
        queryMs: 4,
      });
    });

    expect(await within(panel).findByLabelText("resolved width log")).toBeVisible();
    expect(within(panel).queryByText("Searching logs...")).not.toBeInTheDocument();
  });

  it("ignores a stale older page after the filter changes", async () => {
    const olderPage = createDeferred<Awaited<ReturnType<NonNullable<WorkspaceApi["queryDeviceLogs"]>>>>();
    const queryDeviceLogs = vi.fn(async (request) => {
      if (request.cursorSeq === 10) {
        return olderPage.promise;
      }
      if (request.query === "height") {
        return {
          rows: [makeRow(20, "fresh height log")],
          totalCandidates: 1,
          scannedLines: 1,
          truncated: false,
          nextCursorSeq: null,
          budgetExceeded: false,
          queryMs: 2,
        };
      }
      return {
        rows: [makeRow(10, "newest width log")],
        totalCandidates: 2,
        scannedLines: 1,
        truncated: true,
        nextCursorSeq: 10,
        budgetExceeded: false,
        queryMs: 4,
      };
    });
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });

    expect(await within(panel).findByLabelText("newest width log")).toBeVisible();
    await user.click(await within(panel).findByRole("button", { name: "Load Older Logs" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "height" } });
    expect(await within(panel).findByLabelText("fresh height log")).toBeVisible();

    act(() => {
      olderPage.resolve({
        rows: [makeRow(8, "stale older width log")],
        totalCandidates: 2,
        scannedLines: 1,
        truncated: false,
        nextCursorSeq: null,
        budgetExceeded: false,
        queryMs: 3,
      });
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(within(panel).queryByLabelText("stale older width log")).not.toBeInTheDocument();
  });

  it("keeps loading possible when the scan budget is reached before a match", async () => {
    const queryDeviceLogs = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [],
        totalCandidates: 2,
        scannedLines: 2,
        truncated: false,
        nextCursorSeq: 42,
        budgetExceeded: true,
        queryMs: 5,
      })
      .mockResolvedValueOnce({
        rows: [{
          seq: 40,
          receivedAtMs: 68_000,
          raw: "06-25 15:21:40.123  1234  5678 E C03F00/AppTag com.example.demo: late width hit",
          timestamp: "06-25 15:21:40.123",
          level: "error",
          pid: 1234,
          tid: 5678,
          process: "com.example.demo",
          domain: "C03F00",
          tag: "AppTag",
          message: "late width hit",
        }],
        totalCandidates: 3,
        scannedLines: 1,
        truncated: false,
        nextCursorSeq: null,
        budgetExceeded: false,
        queryMs: 2,
      });
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });

    expect(await within(panel).findByText(/scan budget reached/u)).toBeVisible();
    expect(await within(panel).findByText(/Load Older to continue/u)).toBeVisible();
    await user.click(await within(panel).findByRole("button", { name: "Load Older Logs" }));

    expect(await within(panel).findByLabelText("late width hit")).toBeVisible();
    expect(queryDeviceLogs).toHaveBeenLastCalledWith(expect.objectContaining({ cursorSeq: 42 }));
  });

  it("shows deadline-specific feedback when a query stops on time budget", async () => {
    const queryDeviceLogs = vi.fn().mockResolvedValueOnce({
      rows: [],
      totalCandidates: 2,
      scannedLines: 1,
      truncated: false,
      nextCursorSeq: 42,
      budgetExceeded: true,
      stopReason: "deadline",
      queryMs: 120,
    });
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });

    expect(await within(panel).findByText(/time budget reached/u)).toBeVisible();
    expect(await within(panel).findByText(/Load Older to continue/u)).toBeVisible();
  });

  it("shows when a backend query was superseded by a newer query", async () => {
    const queryDeviceLogs = vi.fn().mockResolvedValueOnce({
      rows: [],
      totalCandidates: 100,
      scannedLines: 3,
      truncated: false,
      nextCursorSeq: null,
      continuationCursorSeq: null,
      continuationReason: "cancelled",
      budgetExceeded: false,
      stopReason: "cancelled",
      queryMs: 1,
    });
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });

    expect(await within(panel).findByText(/superseded by a newer query/u)).toBeVisible();
  });

  it("shows backend regex guard errors in the query summary", async () => {
    const queryDeviceLogs = vi.fn().mockRejectedValue(new Error("Device log regex is too long; use 2048 characters or fewer"));
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "a+".repeat(1_100) } });
    await user.click(within(panel).getAllByLabelText("Regex")[0]);

    expect(await within(panel).findByText(/Device log regex is too long/u)).toBeVisible();
  });

  it("loads older backend query matches with cursor pagination", async () => {
    const queryDeviceLogs = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          seq: 10,
          receivedAtMs: 70_000,
          raw: "06-25 15:21:50.123  1234  5678 I C03F00/AppTag com.example.demo: newest width log",
          timestamp: "06-25 15:21:50.123",
          level: "info",
          pid: 1234,
          tid: 5678,
          process: "com.example.demo",
          domain: "C03F00",
          tag: "AppTag",
          message: "newest width log",
        }],
        totalCandidates: 2,
        scannedLines: 1,
        truncated: true,
        nextCursorSeq: 10,
        budgetExceeded: false,
        queryMs: 4,
      })
      .mockResolvedValueOnce({
        rows: [{
          seq: 8,
          receivedAtMs: 69_000,
          raw: "06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: older width log",
          timestamp: "06-25 15:21:48.123",
          level: "info",
          pid: 1234,
          tid: 5678,
          process: "com.example.demo",
          domain: "C03F00",
          tag: "AppTag",
          message: "older width log",
        }],
        totalCandidates: 2,
        scannedLines: 1,
        truncated: false,
        nextCursorSeq: null,
        budgetExceeded: false,
        queryMs: 3,
      });
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi(queryDeviceLogs)} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "width" } });

    expect(await within(panel).findByLabelText("newest width log")).toBeVisible();
    await user.click(await within(panel).findByRole("button", { name: "Load Older Logs" }));

    expect(await within(panel).findByLabelText("older width log")).toBeVisible();
    expect(queryDeviceLogs).toHaveBeenLastCalledWith(expect.objectContaining({ cursorSeq: 10 }));
    expect(within(panel).queryByRole("button", { name: "Load Older Logs" })).not.toBeInTheDocument();
  });
});

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
