import { describe, expect, it, vi } from "vitest";
import { buildSearchEverywhereControllerResult } from "@/components/layout/search-controller-result";
import { createSearchSessionStore } from "@/features/search/search-session-store";

describe("search controller result", () => {
  it("combines state, actions, and session compat fields", () => {
    const store = createSearchSessionStore();
    store.patch({
      candidates: [{ id: "Entry", title: "Entry", subtitle: "Entry", source: "file", kind: "file", score: 1, freshness: "ready" }],
      selectedIndex: 2,
      previewContent: "preview",
      textNextCursor: { pathIndex: 1, lineIndex: 2 },
    });
    const openSearchOverlay = vi.fn();
    const result = buildSearchEverywhereControllerResult({
      state: {
        searchEverywhereMode: "searchEverywhere",
        searchEverywhereScope: "all",
        searchEverywhereReplaceQuery: "",
        searchEverywhereOptions: { caseSensitive: false, wholeWord: false },
      },
      actions: {
        setSearchEverywhereScope: vi.fn(),
        setSearchEverywhereReplaceQuery: vi.fn(),
        setSearchEverywhereSelectedIndex: vi.fn(),
        openSearchOverlay,
        handleOverlayQueryChange: vi.fn(),
        resetSearchOverlayState: vi.fn(),
        moveSearchEverywhereSelection: vi.fn(),
        openSearchEverywhereResult: vi.fn(),
        openSearchEverywhereCandidate: vi.fn(),
        openSelectedSearchEverywhereResult: vi.fn(),
        loadNextSearchEverywherePage: vi.fn(),
        toggleSearchEverywhereCaseSensitive: vi.fn(),
        toggleSearchEverywhereWholeWord: vi.fn(),
      },
      searchSessionStore: store,
    });

    result.openSearchOverlay("find");

    expect(openSearchOverlay).toHaveBeenCalledWith("find");
    expect(result.searchSessionStore).toBe(store);
    expect(result.searchEverywhereCandidates).toHaveLength(1);
    expect(result.searchEverywhereSelectedIndex).toBe(2);
    expect(result.searchEverywherePreviewContent).toBe("preview");
    expect(result.searchEverywhereCanLoadMore).toBe(true);
  });
});
