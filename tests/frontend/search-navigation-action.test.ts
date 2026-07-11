import { describe, expect, it, vi } from "vitest";
import {
  openSelectedSearchNavigation,
  resolveSelectedSearchNavigationTarget,
  openSearchCandidateNavigation,
  openSearchResultNavigation,
} from "@/components/layout/search-navigation-action";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search navigation action", () => {
  it("resolves selected candidate targets in search everywhere mode", () => {
    const selected = candidate({ title: "Selected", path: "/workspace/Selected.ets" });
    const target = resolveSelectedSearchNavigationTarget({
      mode: "searchEverywhere",
      selectedIndex: 1,
      candidates: [candidate({ title: "First" }), selected],
      matches: [textMatch("width")],
    });

    expect(target).toEqual({ kind: "candidate", candidate: selected });
  });

  it("resolves selected text result targets outside search everywhere mode", () => {
    const selected = textMatch("height");
    const target = resolveSelectedSearchNavigationTarget({
      mode: "find",
      selectedIndex: 1,
      candidates: [candidate()],
      matches: [textMatch("width"), selected],
    });

    expect(target).toEqual({ kind: "result", result: selected });
  });

  it("returns null for missing selected targets", () => {
    const target = resolveSelectedSearchNavigationTarget({
      mode: "replace",
      selectedIndex: 5,
      candidates: [],
      matches: [],
    });

    expect(target).toBeNull();
  });

  it("opens the selected search target through the shared action", async () => {
    const navigateToLocation = vi.fn(async () => undefined);

    await openSelectedSearchNavigation({
      mode: "find",
      selectedIndex: 0,
      candidates: [],
      matches: [textMatch("width")],
      now: () => 300,
      rememberCurrentLocation: vi.fn(),
      closeSearchOverlayForNavigation: vi.fn(),
      navigateToLocation,
      recordUiInteraction: vi.fn(),
    });

    expect(navigateToLocation).toHaveBeenCalledWith({ path: "/workspace/width.ets", line: 3, column: 4 }, "Usage");
  });

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

function textMatch(summary: string) {
  return {
    path: `/workspace/${summary}.ets`,
    relativePath: `${summary}.ets`,
    fileName: `${summary}.ets`,
    line: 3,
    column: 4,
    summary,
    preview: summary,
    previewStart: 0,
    previewEnd: summary.length,
    contextBefore: [],
    contextAfter: [],
  };
}
