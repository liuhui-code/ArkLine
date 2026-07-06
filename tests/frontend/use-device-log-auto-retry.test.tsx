import { act, renderHook } from "@testing-library/react";
import { useDeviceLogAutoRetry } from "@/features/device-log/use-device-log-auto-retry";

describe("useDeviceLogAutoRetry", () => {
  it("runs bounded retries with injectable delays and exposes exhaustion", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const onExhausted = vi.fn();

    try {
      const { result } = renderHook(() => useDeviceLogAutoRetry({
        deviceId: "device-1",
        retryDelaysMs: [1, 2, 3],
        onExhausted,
        onRetry,
      }));

      act(() => result.current.scheduleAutoRetry());
      expect(result.current.autoRetryMs).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(onRetry).toHaveBeenCalledTimes(1);

      act(() => result.current.scheduleAutoRetry());
      expect(result.current.autoRetryMs).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
      expect(onRetry).toHaveBeenCalledTimes(2);

      act(() => result.current.scheduleAutoRetry());
      expect(result.current.autoRetryMs).toBe(3);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3);
      });
      expect(onRetry).toHaveBeenCalledTimes(3);

      act(() => result.current.scheduleAutoRetry());
      expect(result.current.autoRetryExhausted).toBe(true);
      expect(onExhausted).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(onRetry).toHaveBeenCalledTimes(3);

      act(() => result.current.resetRetryBudget());
      act(() => result.current.scheduleAutoRetry());
      expect(result.current.autoRetryMs).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses automatic retries until the user resumes them", async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();

    try {
      const { result } = renderHook(() => useDeviceLogAutoRetry({
        deviceId: "device-1",
        retryDelaysMs: [1],
        onExhausted: () => undefined,
        onRetry,
      }));

      act(() => result.current.pauseAutoRetry());
      act(() => result.current.scheduleAutoRetry());
      expect(result.current.autoRetryPaused).toBe(true);
      expect(result.current.autoRetryMs).toBe(null);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(onRetry).not.toHaveBeenCalled();

      act(() => result.current.resumeAutoRetry());
      act(() => result.current.scheduleAutoRetry());
      expect(result.current.autoRetryPaused).toBe(false);
      expect(result.current.autoRetryMs).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
