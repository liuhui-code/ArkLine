import { describe, expect, it, vi } from "vitest";
import { createSearchOverlayCommandActions } from "@/components/layout/search-overlay-command-actions";

describe("search overlay command actions", () => {
  it("opens Search Everywhere with selected editor text", () => {
    const setSearchEverywhereMode = vi.fn();
    const setSearchEverywhereScope = vi.fn();
    const setQuickOpenQuery = vi.fn();
    const setActiveOverlay = vi.fn();
    const actions = createSearchOverlayCommandActions({
      mode: "searchEverywhere",
      editorSelectedText: "  Entry\nAbility  ",
      invalidateSearchSession: vi.fn(),
      resetDebouncedSearchQuery: vi.fn(),
      patchSearchSession: vi.fn(),
      recordUiInteraction: vi.fn(),
      setSearchEverywhereMode,
      setSearchEverywhereScope,
      setQuickOpenQuery,
      setActiveOverlay,
      setSearchEverywhereOptions: vi.fn(),
    });

    actions.openSearchOverlay("searchEverywhere");

    expect(setSearchEverywhereMode).toHaveBeenCalledWith("searchEverywhere");
    expect(setSearchEverywhereScope).toHaveBeenCalledWith("all");
    expect(setQuickOpenQuery).toHaveBeenCalledWith("Entry Ability");
    expect(setActiveOverlay).toHaveBeenCalledWith("searchEverywhere");
  });

  it("invalidates before applying query changes", () => {
    const invalidateSearchSession = vi.fn();
    const setQuickOpenQuery = vi.fn();
    const actions = createSearchOverlayCommandActions({
      mode: "find",
      editorSelectedText: "",
      invalidateSearchSession,
      resetDebouncedSearchQuery: vi.fn(),
      patchSearchSession: vi.fn(),
      recordUiInteraction: vi.fn(),
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery,
      setActiveOverlay: vi.fn(),
      setSearchEverywhereOptions: vi.fn(),
    });

    actions.handleOverlayQueryChange("width");

    expect(invalidateSearchSession).toHaveBeenCalled();
    expect(setQuickOpenQuery).toHaveBeenCalledWith("width");
  });

  it("toggles text search options through functional state updates", () => {
    const setSearchEverywhereOptions = vi.fn();
    const actions = createSearchOverlayCommandActions({
      mode: "find",
      editorSelectedText: "",
      invalidateSearchSession: vi.fn(),
      resetDebouncedSearchQuery: vi.fn(),
      patchSearchSession: vi.fn(),
      recordUiInteraction: vi.fn(),
      setSearchEverywhereMode: vi.fn(),
      setSearchEverywhereScope: vi.fn(),
      setQuickOpenQuery: vi.fn(),
      setActiveOverlay: vi.fn(),
      setSearchEverywhereOptions,
    });

    actions.toggleSearchEverywhereCaseSensitive();
    actions.toggleSearchEverywhereWholeWord();

    expect(setSearchEverywhereOptions).toHaveBeenCalledTimes(2);
    expect(setSearchEverywhereOptions.mock.calls[0]?.[0]({
      caseSensitive: false,
      wholeWord: false,
    })).toEqual({ caseSensitive: true, wholeWord: false });
    expect(setSearchEverywhereOptions.mock.calls[1]?.[0]({
      caseSensitive: true,
      wholeWord: false,
    })).toEqual({ caseSensitive: true, wholeWord: true });
  });
});
