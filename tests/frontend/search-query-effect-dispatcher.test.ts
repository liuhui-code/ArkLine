import { describe, expect, it, vi } from "vitest";
import { dispatchSearchOverlayQueryEffect } from "@/components/layout/search-query-effect-dispatcher";

describe("search query effect dispatcher", () => {
  it("ignores inactive overlays", () => {
    const startQuery = vi.fn();

    dispatchSearchOverlayQueryEffect({
      activeOverlay: "none",
      mode: "searchEverywhere",
      query: "Entry",
      hasWorkspace: true,
      startQuery,
      clearSearchResults: vi.fn(),
      runEntitySearch: vi.fn(),
      runTextSearch: vi.fn(),
    });

    expect(startQuery).not.toHaveBeenCalled();
  });

  it("starts and clears when no workspace is available", () => {
    const clearSearchResults = vi.fn();
    const startQuery = vi.fn(() => 3);

    dispatchSearchOverlayQueryEffect({
      activeOverlay: "searchEverywhere",
      mode: "searchEverywhere",
      query: "  Entry  ",
      hasWorkspace: false,
      startQuery,
      clearSearchResults,
      runEntitySearch: vi.fn(),
      runTextSearch: vi.fn(),
    });

    expect(startQuery).toHaveBeenCalledWith("searchEverywhere");
    expect(clearSearchResults).toHaveBeenCalledWith("Entry");
  });

  it("dispatches entity and text query modes", () => {
    const runEntitySearch = vi.fn();
    const runTextSearch = vi.fn();

    dispatchSearchOverlayQueryEffect({
      activeOverlay: "searchEverywhere",
      mode: "searchEverywhere",
      query: "Entry",
      hasWorkspace: true,
      startQuery: vi.fn(() => 7),
      clearSearchResults: vi.fn(),
      runEntitySearch,
      runTextSearch,
    });
    dispatchSearchOverlayQueryEffect({
      activeOverlay: "searchEverywhere",
      mode: "find",
      query: "width",
      hasWorkspace: true,
      startQuery: vi.fn(() => 8),
      clearSearchResults: vi.fn(),
      runEntitySearch,
      runTextSearch,
    });

    expect(runEntitySearch).toHaveBeenCalledWith(7);
    expect(runTextSearch).toHaveBeenCalledWith(8);
  });
});
