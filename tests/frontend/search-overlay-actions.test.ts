import { describe, expect, it, vi } from "vitest";
import {
  closeSearchOverlayForNavigationAction,
  handleSearchOverlayQueryChangeAction,
  openSearchOverlayAction,
  resetSearchOverlayStateAction,
} from "@/components/layout/search-overlay-actions";

describe("search overlay actions", () => {
  it("opens search everywhere with normalized selected text and all scope", () => {
    const setSearchEverywhereMode = vi.fn();
    const setSearchEverywhereScope = vi.fn();
    const setQuickOpenQuery = vi.fn();
    const setActiveOverlay = vi.fn();

    openSearchOverlayAction({
      mode: "searchEverywhere",
      editorSelectedText: "  Login   Controller  ",
      setSearchEverywhereMode,
      setSearchEverywhereScope,
      setQuickOpenQuery,
      setActiveOverlay,
    });

    expect(setSearchEverywhereMode).toHaveBeenCalledWith("searchEverywhere");
    expect(setSearchEverywhereScope).toHaveBeenCalledWith("all");
    expect(setQuickOpenQuery).toHaveBeenCalledWith("Login Controller");
    expect(setActiveOverlay).toHaveBeenCalledWith("searchEverywhere");
  });

  it("opens find with selected text only when it normalizes to a valid query", () => {
    const setQuickOpenQuery = vi.fn();
    const setActiveOverlay = vi.fn();

    openSearchOverlayAction({
      mode: "find",
      editorSelectedText: "width",
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery,
      setActiveOverlay,
    });
    openSearchOverlayAction({
      mode: "replace",
      editorSelectedText: "",
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery,
      setActiveOverlay,
    });

    expect(setQuickOpenQuery).toHaveBeenCalledTimes(1);
    expect(setQuickOpenQuery).toHaveBeenCalledWith("width");
    expect(setActiveOverlay).toHaveBeenCalledWith("searchEverywhere");
  });

  it("invalidates current search before applying overlay query changes", () => {
    const events: string[] = [];

    handleSearchOverlayQueryChangeAction({
      value: "Entry",
      invalidateSearchSession: () => events.push("invalidate"),
      setQuickOpenQuery: (value) => events.push(`query:${value}`),
    });

    expect(events).toEqual(["invalidate", "query:Entry"]);
  });

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
