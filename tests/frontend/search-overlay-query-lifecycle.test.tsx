import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSearchOverlayDebouncedQuery } from "@/components/layout/search-overlay-query-lifecycle";

describe("search overlay query lifecycle", () => {
  it("uses the query already committed by the isolated input", () => {
    const invalidateSearchSession = vi.fn();
    const navigationCloseHandledRef = { current: false };

    const { result, rerender } = renderHook(
      ({ query }) => useSearchOverlayDebouncedQuery({
        activeOverlay: "searchEverywhere",
        quickOpenQuery: query,
        mode: "searchEverywhere",
        navigationCloseHandledRef,
        invalidateSearchSession,
      }),
      { initialProps: { query: "Ent" } },
    );

    expect(result.current.debouncedSearchQuery).toBe("Ent");
    rerender({ query: "Entry" });
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
      navigationCloseHandledRef,
      invalidateSearchSession,
    }));

    expect(invalidateSearchSession).not.toHaveBeenCalled();
    expect(navigationCloseHandledRef.current).toBe(false);
  });
});
