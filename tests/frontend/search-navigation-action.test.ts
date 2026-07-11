import { describe, expect, it, vi } from "vitest";
import {
  openSearchCandidateNavigation,
  openSearchResultNavigation,
} from "@/components/layout/search-navigation-action";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search navigation action", () => {
  it("opens a text result after closing the search overlay", async () => {
    const events: string[] = [];
    const navigateToLocation = vi.fn(async () => {
      events.push("navigate");
    });
    const recordUiInteraction = vi.fn();

    await openSearchResultNavigation({
      path: "/workspace/src/Entry.ets",
      line: 8,
      column: 3,
      now: () => 100,
      rememberCurrentLocation: () => events.push("remember"),
      closeSearchOverlayForNavigation: () => events.push("close"),
      navigateToLocation,
      recordUiInteraction,
    });

    expect(events).toEqual(["remember", "close", "navigate"]);
    expect(navigateToLocation).toHaveBeenCalledWith({ path: "/workspace/src/Entry.ets", line: 8, column: 3 }, "Usage");
    expect(recordUiInteraction).toHaveBeenCalledWith("searchJump", "Entry.ets", 100, 100);
  });

  it("opens a candidate using its title and default location", async () => {
    const navigateToLocation = vi.fn(async () => undefined);
    const recordUiInteraction = vi.fn();

    await openSearchCandidateNavigation({
      candidate: candidate({ path: "/workspace/Entry.ets" }),
      now: () => 200,
      rememberCurrentLocation: vi.fn(),
      closeSearchOverlayForNavigation: vi.fn(),
      navigateToLocation,
      recordUiInteraction,
    });

    expect(navigateToLocation).toHaveBeenCalledWith({ path: "/workspace/Entry.ets", line: 1, column: 1 }, "Usage");
    expect(recordUiInteraction).toHaveBeenCalledWith("searchJump", "EntryAbility", 200, 200);
  });

  it("ignores candidates without paths", async () => {
    const navigateToLocation = vi.fn(async () => undefined);

    await openSearchCandidateNavigation({
      candidate: candidate({ path: undefined }),
      now: () => 1,
      rememberCurrentLocation: vi.fn(),
      closeSearchOverlayForNavigation: vi.fn(),
      navigateToLocation,
      recordUiInteraction: vi.fn(),
    });

    expect(navigateToLocation).not.toHaveBeenCalled();
  });
});

function candidate(overrides: Partial<SearchCandidate> = {}): SearchCandidate {
  return {
    id: "Entry",
    title: "EntryAbility",
    subtitle: "EntryAbility",
    source: "class",
    kind: "class",
    path: "/workspace/Entry.ets",
    score: 1,
    freshness: "ready",
    ...overrides,
  };
}
