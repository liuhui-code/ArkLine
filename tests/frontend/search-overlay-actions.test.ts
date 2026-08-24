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
      getEditorSelectedText: () => "  Login   Controller  ",
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

  it("opens find and replace with isolated selected-text queries", () => {
    const setQuickOpenQuery = vi.fn();
    const setActiveOverlay = vi.fn();

    openSearchOverlayAction({
      mode: "find",
      getEditorSelectedText: () => "width",
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery,
      setActiveOverlay,
    });
    openSearchOverlayAction({
      mode: "replace",
      getEditorSelectedText: () => "",
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery,
      setActiveOverlay,
    });

    expect(setQuickOpenQuery).toHaveBeenNthCalledWith(1, "width");
    expect(setQuickOpenQuery).toHaveBeenNthCalledWith(2, "");
    expect(setActiveOverlay).toHaveBeenCalledWith("searchEverywhere");
  });

  it("restores the previous query when the editor has no selection", () => {
    const setQuickOpenQuery = vi.fn();

    const query = openSearchOverlayAction({
      mode: "find",
      restoredQuery: "previous query",
      getEditorSelectedText: () => "",
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery,
      setActiveOverlay: vi.fn(),
    });

    expect(query).toBe("previous query");
    expect(setQuickOpenQuery).toHaveBeenCalledWith("previous query");
  });

  it("prefers an explicit query over selection and restored state", () => {
    const setQuickOpenQuery = vi.fn();

    openSearchOverlayAction({
      mode: "searchEverywhere",
      explicitQuery: "retry query",
      restoredQuery: "previous query",
      getEditorSelectedText: () => "selected text",
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery,
      setActiveOverlay: vi.fn(),
    });

    expect(setQuickOpenQuery).toHaveBeenCalledWith("retry query");
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
