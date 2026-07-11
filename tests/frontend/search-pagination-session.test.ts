import { describe, expect, it } from "vitest";
import {
  buildTextSearchAppendPatch,
  resolveSearchSelectionMove,
} from "@/components/layout/search-pagination-session";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";

describe("search pagination session", () => {
  it("wraps selection movement within visible results", () => {
    expect(resolveSearchSelectionMove({
      mode: "find",
      direction: 1,
      selectedIndex: 1,
      resultCount: 3,
      canLoadMore: false,
    })).toEqual({ kind: "select", selectedIndex: 2 });

    expect(resolveSearchSelectionMove({
      mode: "find",
      direction: -1,
      selectedIndex: 0,
      resultCount: 3,
      canLoadMore: false,
    })).toEqual({ kind: "select", selectedIndex: 2 });
  });

  it("loads the next page when moving past the final result", () => {
    expect(resolveSearchSelectionMove({
      mode: "searchEverywhere",
      direction: 1,
      selectedIndex: 49,
      resultCount: 50,
      canLoadMore: true,
    })).toEqual({ kind: "loadMore", selectIndexAfterLoad: 50 });
  });

  it("does nothing when no results are visible", () => {
    expect(resolveSearchSelectionMove({
      mode: "replace",
      direction: 1,
      selectedIndex: 0,
      resultCount: 0,
      canLoadMore: true,
    })).toEqual({ kind: "none" });
  });

  it("appends text search pages and preserves selection by default", () => {
    const patch = buildTextSearchAppendPatch(
      {
        result: result(["first"]),
        selectedIndex: 3,
      },
      {
        ...result(["second"]),
        nextCursor: { pathIndex: 1, lineIndex: 2 },
        limitReached: true,
      },
    );

    expect(patch.result.matches.map((item) => item.summary)).toEqual(["first", "second"]);
    expect(patch.textNextCursor).toEqual({ pathIndex: 1, lineIndex: 2 });
    expect(patch.textPageLoading).toBe(false);
    expect(patch.selectedIndex).toBe(3);
    expect(patch.truncationNotice).toContain("Showing first 1 matches");
  });

  it("uses the requested selection after auto-loading another page", () => {
    const patch = buildTextSearchAppendPatch(
      {
        result: result(["first"]),
        selectedIndex: 0,
      },
      result(["second"]),
      1,
    );

    expect(patch.selectedIndex).toBe(1);
    expect(patch.textNextCursor).toBeNull();
    expect(patch.truncationNotice).toBeNull();
  });
});

function result(summaries: string[]): WorkspaceTextSearchResult {
  return {
    query: { kind: "text", query: "width" },
    matches: summaries.map((summary, index) => ({
      path: `/workspace/${summary}.ets`,
      relativePath: `${summary}.ets`,
      fileName: `${summary}.ets`,
      line: index + 1,
      column: 1,
      summary,
      preview: summary,
      previewStart: 0,
      previewEnd: summary.length,
      contextBefore: [],
      contextAfter: [],
    })),
  };
}
