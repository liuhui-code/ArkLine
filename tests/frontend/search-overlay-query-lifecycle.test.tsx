import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSearchOverlayDebouncedQuery } from "@/components/layout/search-overlay-query-lifecycle";

describe("search overlay query lifecycle", () => {
  it("debounces active search overlay query changes", () => {
    vi.useFakeTimers();
    const invalidateSearchSession = vi.fn();
    const navigationCloseHandledRef = { current: false };

    const { result, rerender } = renderHook(
      ({ query }) => useSearchOverlayDebouncedQuery({
        activeOverlay: "searchEverywhere",
        quickOpenQuery: query,
        mode: "searchEverywhere",
        debounceMs: { searchEverywhere: 140, find: 260, replace: 260 },
        navigationCloseHandledRef,
        invalidateSearchSession,
      }),
      { initialProps: { query: "Ent" } },
    );

    expect(result.current.debouncedSearchQuery).toBe("");
    rerender({ query: "Entry" });
    act(() => vi.advanceTimersByTime(139));
    expect(result.current.debouncedSearchQuery).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.debouncedSearchQuery).toBe("Entry");
    expect(invalidateSearchSession).not.toHaveBeenCalled();
  });

  it("syncs immediately and invalidates when search overlay is not active", () => {
    const invalidateSearchSession = vi.fn();
    const navigationCloseHandledRef = { current: false };

    const { result } = renderHook(() => useSearchOverlayDebouncedQuery({
      activeOverlay: "none",
      quickOpenQuery: "Entry",
      mode: "searchEverywhere",
      debounceMs: { searchEverywhere: 140, find: 260, replace: 260 },
      navigationCloseHandledRef,
      invalidateSearchSession,
    }));

    expect(result.current.debouncedSearchQuery).toBe("Entry");
    expect(invalidateSearchSession).toHaveBeenCalledTimes(1);
  });

  it("skips one invalidation after navigation close", () => {
    const invalidateSearchSession = vi.fn();
    const navigationCloseHandledRef = { current: true };

    renderHook(() => useSearchOverlayDebouncedQuery({
      activeOverlay: "none",
      quickOpenQuery: "Entry",
      mode: "searchEverywhere",
      debounceMs: { searchEverywhere: 140, find: 260, replace: 260 },
      navigationCloseHandledRef,
      invalidateSearchSession,
    }));

    expect(invalidateSearchSession).not.toHaveBeenCalled();
    expect(navigationCloseHandledRef.current).toBe(false);
  });
});
