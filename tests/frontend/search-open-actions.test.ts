import { describe, expect, it, vi } from "vitest";
import { createSearchOpenActions } from "@/components/layout/search-open-actions";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search open actions", () => {
  it("opens text results through navigation dependencies", async () => {
    const rememberCurrentLocation = vi.fn();
    const closeSearchOverlayForNavigation = vi.fn();
    const navigateToLocation = vi.fn(async () => undefined);
    const actions = createSearchOpenActions({
      mode: "find",
      sessionStore: createSearchSessionStore(),
      rememberCurrentLocation,
      closeSearchOverlayForNavigation,
      navigateToLocation,
      recordUiInteraction: vi.fn(),
    });

    await actions.openResult("/workspace/Entry.ets", 3, 5);

    expect(rememberCurrentLocation).toHaveBeenCalled();
    expect(closeSearchOverlayForNavigation).toHaveBeenCalled();
    expect(navigateToLocation).toHaveBeenCalledWith({ path: "/workspace/Entry.ets", line: 3, column: 5 }, "Usage");
  });

  it("opens entity candidates through navigation dependencies", async () => {
    const navigateToLocation = vi.fn(async () => undefined);
    const actions = createSearchOpenActions({
      mode: "searchEverywhere",
      sessionStore: createSearchSessionStore(),
      rememberCurrentLocation: vi.fn(),
      closeSearchOverlayForNavigation: vi.fn(),
      navigateToLocation,
      recordUiInteraction: vi.fn(),
    });

    await actions.openCandidate(candidate("Entry"));

    expect(navigateToLocation).toHaveBeenCalledWith({ path: "/workspace/Entry.ets", line: 2, column: 4 }, "Usage");
  });

  it("opens the currently selected result from the session", async () => {
    const store = createSearchSessionStore();
    const navigateToLocation = vi.fn(async () => undefined);
    store.patch({
      result: {
        query: { kind: "text", query: "width" },
        matches: [{
          path: "/workspace/Other.ets",
          relativePath: "Other.ets",
          fileName: "Other.ets",
          line: 7,
          column: 9,
          summary: "width",
          preview: "width",
          previewStart: 0,
          previewEnd: 5,
          contextBefore: [],
          contextAfter: [],
        }],
      },
      selectedIndex: 0,
    });
    const actions = createSearchOpenActions({
      mode: "find",
      sessionStore: store,
      rememberCurrentLocation: vi.fn(),
      closeSearchOverlayForNavigation: vi.fn(),
      navigateToLocation,
      recordUiInteraction: vi.fn(),
    });

    await actions.openSelected();

    expect(navigateToLocation).toHaveBeenCalledWith({ path: "/workspace/Other.ets", line: 7, column: 9 }, "Usage");
  });
});

function candidate(title: string): SearchCandidate {
  return {
    id: `file:${title}`,
    source: "file",
    kind: "file",
    title,
    subtitle: title,
    path: `/workspace/${title}.ets`,
    line: 2,
    column: 4,
    score: 1,
    freshness: "ready",
  };
}
