import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeviceLogStore } from "@/features/device-log/device-log-store";
import { useDeviceLogLiveBuffer } from "@/features/device-log/use-device-log-live-buffer";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useDeviceLogLiveBuffer", () => {
  it("coalesces live batches and ignores other devices", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const store = createDeviceLogStore({ capacity: 10 });
    const { result } = renderHook(() => useDeviceLogLiveBuffer({ deviceId: "device-1", store }));

    act(() => {
      result.current.appendLines("device-1", ["one"]);
      result.current.appendLines("device-2", ["ignored"]);
      result.current.appendLines("device-1", ["two"]);
    });

    expect(callbacks).toHaveLength(1);
    expect(result.current.entries.map((entry) => entry.message)).toEqual([]);

    act(() => callbacks[0]?.(performance.now()));

    expect(result.current.entries.map((entry) => entry.message)).toEqual(["one", "two"]);
  });

  it("buffers incoming lines while paused and reveals them on resume", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const store = createDeviceLogStore({ capacity: 10 });
    const { result } = renderHook(() => useDeviceLogLiveBuffer({ deviceId: "device-1", store }));

    act(() => {
      result.current.pauseLiveView();
      result.current.appendLines("device-1", ["pending one", "pending two"]);
    });
    act(() => callbacks[0]?.(performance.now()));

    expect(result.current.livePaused).toBe(true);
    expect(result.current.entries).toHaveLength(0);
    expect(result.current.pendingLiveEntries).toBe(2);

    act(() => result.current.resumeLiveView());

    expect(result.current.livePaused).toBe(false);
    expect(result.current.pendingLiveEntries).toBe(0);
    expect(result.current.entries.map((entry) => entry.message)).toEqual(["pending one", "pending two"]);
  });

  it("flushes pending live batches when animation frames are delayed", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const store = createDeviceLogStore({ capacity: 10 });
    const { result } = renderHook(() => useDeviceLogLiveBuffer({ deviceId: "device-1", store }));

    act(() => {
      result.current.appendLines("device-1", ["delayed frame line"]);
    });
    expect(result.current.entries).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.entries.map((entry) => entry.message)).toEqual(["delayed frame line"]);
  });
});
