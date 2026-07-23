import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUiLatencyMonitor } from "@/features/performance/use-ui-latency-monitor";

afterEach(() => {
  vi.useRealTimers();
});

describe("useUiLatencyMonitor", () => {
  it("records heartbeat lag without rerendering the app shell", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useUiLatencyMonitor();
    });

    act(() => {
      vi.setSystemTime(1_000);
      vi.advanceTimersByTime(50);
    });

    expect(renderCount).toBe(1);

    act(() => {
      result.current.recordUiInteraction("globalSearch", "target", 1_000, 1_020);
    });

    expect(renderCount).toBe(2);
    expect(result.current.uiLatencySamples.map((sample) => sample.kind)).toEqual([
      "globalSearch",
      "eventLoopLag",
    ]);
  });
});
