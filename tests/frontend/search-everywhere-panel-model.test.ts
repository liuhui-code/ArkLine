import { describe, expect, it } from "vitest";
import { buildSearchEverywherePanelViewModel } from "@/components/layout/search-everywhere-panel-model";
import type { WorkspaceTextSearchMatch, WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search everywhere panel model", () => {
  it("builds the text search view model from matches and selection", () => {
    const result: WorkspaceTextSearchResult = {
      query: { kind: "text", query: "width" },
      matches: [
        match("/workspace/src/A.ets", "src/A.ets", "A.ets", 4),
        match("/workspace/src/A.ets", "src/A.ets", "A.ets", 9),
        match("/workspace/src/B.ets", "src/B.ets", "B.ets", 2),
      ],
    };

    const model = buildSearchEverywherePanelViewModel({
      mode: "find",
      result,
      candidates: [],
      selectedIndex: 1,
    });

    expect(model.resultsLabel).toBe("Find in Files Results");
    expect(model.resultCount).toBe(3);
    expect(model.selectedTextMatch?.line).toBe(9);
    expect(model.textGroups.map((group) => [group.fileName, group.matches.length])).toEqual([
      ["A.ets", 2],
      ["B.ets", 1],
    ]);
  });

  it("builds Search Everywhere candidate groups and count", () => {
    const model = buildSearchEverywherePanelViewModel({
      mode: "searchEverywhere",
      result: { query: { kind: "text", query: "Entry" }, matches: [] },
      candidates: [
        candidate("file", "Entry.ets"),
        candidate("class", "EntryAbility"),
      ],
      selectedIndex: 0,
    });

    expect(model.resultsLabel).toBe("Search Everywhere Results");
    expect(model.resultCount).toBe(2);
    expect(model.candidateGroups.map((group) => group.label)).toEqual(["Classes", "Files"]);
  });
});

function match(path: string, relativePath: string, fileName: string, line: number): WorkspaceTextSearchMatch {
  return {
    path,
    relativePath,
    fileName,
    line,
    column: 1,
    summary: "width",
    preview: "width",
    previewStart: 0,
    previewEnd: 5,
    contextBefore: [],
    contextAfter: [],
  };
}

function candidate(source: SearchCandidate["source"], title: string): SearchCandidate {
  return {
    id: `${source}:${title}`,
    source,
    kind: source,
    title,
    subtitle: title,
    path: `/workspace/${title}`,
    line: 1,
    column: 1,
    score: 100,
    freshness: "ready",
  };
}
