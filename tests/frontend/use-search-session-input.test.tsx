import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearchSessionInput } from "@/components/layout/use-search-session-input";

afterEach(() => {
  vi.useRealTimers();
});

describe("useSearchSessionInput", () => {
  it("commits only the latest find query after the input becomes quiet", () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const { result } = renderHook(() => useSearchSessionInput("", "find", onCommit));

    act(() => {
      result.current.updateDraftQuery("a");
      vi.advanceTimersByTime(120);
      result.current.updateDraftQuery("ar");
      vi.advanceTimersByTime(120);
      result.current.updateDraftQuery("ark");
    });
    act(() => {
      vi.advanceTimersByTime(249);
    });

    expect(onCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("ark");
  });
});
