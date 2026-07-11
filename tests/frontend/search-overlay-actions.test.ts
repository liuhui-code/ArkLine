import { describe, expect, it, vi } from "vitest";
import {
  closeSearchOverlayForNavigationAction,
  resetSearchOverlayStateAction,
} from "@/components/layout/search-overlay-actions";

describe("search overlay actions", () => {
  it("resets search overlay state and records close latency", () => {
    const events: string[] = [];
    const patchSearchSession = vi.fn();
    const recordUiInteraction = vi.fn();

    resetSearchOverlayStateAction({
      mode: "find",
      now: () => 10,
      invalidateSearchSession: () => events.push("invalidate"),
      resetDebouncedSearchQuery: () => events.push("resetDebounce"),
      patchSearchSession,
      recordUiInteraction,
    });

    expect(events).toEqual(["invalidate", "resetDebounce"]);
    expect(recordUiInteraction).toHaveBeenCalledWith("searchClose", "Find in Files", 10, 10);
    expect(patchSearchSession).toHaveBeenCalledWith({ selectedIndex: 0, previewContent: null });
  });

  it("closes search overlay for navigation after invalidating foreground work", () => {
    const navigationCloseHandledRef = { current: false };
    const setActiveOverlay = vi.fn();

    closeSearchOverlayForNavigationAction({
      navigationCloseHandledRef,
      invalidateSearchSession: vi.fn(),
      setActiveOverlay,
    });

    expect(navigationCloseHandledRef.current).toBe(true);
    expect(setActiveOverlay).toHaveBeenCalledWith("none");
  });
});
