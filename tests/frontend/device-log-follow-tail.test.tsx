import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

afterEach(() => {
  vi.restoreAllMocks();
});

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
  };
}

describe("Device Log follow-tail behavior", () => {
  it("keeps high-volume logs stable when the user scrolls away from the tail", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    const log = within(panel).getByRole("log", { name: "Device Log Entries" });
    setLogGeometry(log, { clientHeight: 52, scrollHeight: 780 });

    appendLines(panel, 30);
    expect(await within(panel).findByLabelText("tail line 30")).toBeVisible();

    log.scrollTop = 0;
    fireEvent.scroll(log);

    expect(await within(panel).findByRole("button", { name: "Follow Tail" })).toBeVisible();
    expect(await within(panel).findByLabelText("tail line 1")).toBeVisible();

    appendLines(panel, 1, 31);

    await waitFor(() => expect(within(panel).queryByLabelText("tail line 31")).not.toBeInTheDocument());
    await user.click(within(panel).getByRole("button", { name: "Follow Tail" }));

    expect(await within(panel).findByLabelText("tail line 31")).toBeVisible();
  });

  it("coalesces burst log events into one animation-frame flush", async () => {
    const callbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    const beforeBurst = rafSpy.mock.calls.length;

    for (let batch = 0; batch < 100; batch += 1) {
      appendLines(panel, 5, batch * 5 + 1);
    }

    expect(rafSpy.mock.calls.length - beforeBurst).toBe(1);
    expect(within(panel).queryByLabelText("tail line 500")).not.toBeInTheDocument();

    act(() => {
      callbacks.at(-1)?.(performance.now());
    });

    expect(await within(panel).findByLabelText("tail line 500")).toBeVisible();
    expect(within(panel).getAllByTestId("device-log-entry").length).toBeLessThan(500);
  });

  it("coalesces burst scroll events into one animation-frame update", async () => {
    const callbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    const log = within(panel).getByRole("log", { name: "Device Log Entries" });
    setLogGeometry(log, { clientHeight: 52, scrollHeight: 780 });
    appendLines(panel, 30);
    act(() => callbacks.at(-1)?.(performance.now()));
    expect(await within(panel).findByLabelText("tail line 30")).toBeVisible();
    const beforeScroll = rafSpy.mock.calls.length;

    act(() => {
      for (let offset = 0; offset < 20; offset += 1) {
        log.scrollTop = offset;
        fireEvent.scroll(log);
      }
    });

    expect(rafSpy.mock.calls.length - beforeScroll).toBe(1);
    act(() => callbacks.at(-1)?.(performance.now()));
    expect(within(panel).getByRole("button", { name: "Follow Tail" })).toBeVisible();
  });

  it("pauses the live view without dropping incoming log lines", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    await user.click(screen.getByRole("tab", { name: "HiLog" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    appendLines(panel, 1);
    expect(await within(panel).findByLabelText("tail line 1")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Pause Live Log View" }));
    appendLines(panel, 2, 2);

    await waitFor(() => expect(within(panel).getByText("2 pending while paused")).toBeVisible());
    expect(within(panel).queryByLabelText("tail line 2")).not.toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Resume Live Log View" }));

    expect(await within(panel).findByLabelText("tail line 3")).toBeVisible();
    expect(within(panel).queryByText("2 pending while paused")).not.toBeInTheDocument();
  });
});

function appendLines(panel: HTMLElement, count: number, start = 1) {
  const lines = Array.from({ length: count }, (_, index) => (
    `06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: tail line ${start + index}`
  ));
  fireEvent(
    panel,
    new CustomEvent("arkline-device-log-lines", {
      bubbles: true,
      detail: { deviceId: "device-1", lines },
    }),
  );
}

function setLogGeometry(element: HTMLElement, sizes: { clientHeight: number; scrollHeight: number }) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: sizes.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: sizes.scrollHeight,
  });
}
