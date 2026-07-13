import { capSearchEverywhereCandidates, orderSearchEverywhereCandidates } from "@/components/layout/search-overlay-model";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search overlay model", () => {
  it("prioritizes active and recent paths within search everywhere groups", () => {
    const ranked = orderSearchEverywhereCandidates([
      candidate("symbol", "Other symbol", "/workspace/src/Other.ets", 120),
      candidate("symbol", "Active symbol", "/workspace/src/Active.ets", 90),
      candidate("symbol", "Recent symbol", "/workspace/src/Recent.ets", 110),
    ], {
      activePath: "/workspace/src/Active.ets",
      recentPaths: ["/workspace/src/Recent.ets"],
    });

    expect(ranked.map((item) => item.title)).toEqual([
      "Active symbol",
      "Recent symbol",
      "Other symbol",
    ]);
  });

  it("prioritizes opened paths after recent paths within search everywhere groups", () => {
    const ranked = orderSearchEverywhereCandidates([
      candidate("symbol", "Other symbol", "/workspace/src/Other.ets", 120),
      candidate("symbol", "Opened symbol", "/workspace/src/Opened.ets", 90),
      candidate("symbol", "Recent symbol", "/workspace/src/Recent.ets", 110),
    ], {
      recentPaths: ["/workspace/src/Recent.ets"],
      openedPaths: ["/workspace/src/Opened.ets"],
    });

    expect(ranked.map((item) => item.title)).toEqual([
      "Recent symbol",
      "Opened symbol",
      "Other symbol",
    ]);
  });

  it("uses project proximity when source and score tie", () => {
    const ranked = orderSearchEverywhereCandidates([
      candidate("file", "Remote Settings", "/workspace/features/settings/Settings.ets", 90),
      candidate("file", "Local Settings", "/workspace/src/pages/settings/Settings.ets", 90),
    ], {
      activePath: "/workspace/src/pages/Home.ets",
    });

    expect(ranked.map((item) => item.title)).toEqual([
      "Local Settings",
      "Remote Settings",
    ]);
  });

  it("returns explicit truncation metadata when results exceed the display cap", () => {
    const capped = capSearchEverywhereCandidates([
      candidate("file", "One", "/workspace/One.ets", 100),
      candidate("file", "Two", "/workspace/Two.ets", 90),
      candidate("file", "Three", "/workspace/Three.ets", 80),
    ], {
      scope: "files",
      displayLimit: 2,
    });

    expect(capped.items.map((item) => item.title)).toEqual(["One", "Two"]);
    expect(capped.metadata).toEqual({
      scope: "files",
      displayLimit: 2,
      returnedCount: 2,
      fetchedCount: 3,
      truncated: true,
      hiddenCount: 1,
    });
  });
});

function candidate(
  source: SearchCandidate["source"],
  title: string,
  path: string,
  score: number,
): SearchCandidate {
  return {
    id: `${source}:${path}:${title}`,
    source,
    kind: source,
    title,
    subtitle: path,
    path,
    line: 1,
    column: 1,
    score,
    freshness: "ready",
  };
}
