import { describe, expect, it } from "vitest";
import {
  buildEntitySearchApplication,
  buildTextSearchApplication,
} from "@/components/layout/search-result-application";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search result application", () => {
  it("builds entity result patches and miss report inputs", () => {
    const result = buildEntitySearchApplication({
      query: "Entry",
      scope: "all",
      displayLimit: 10,
      activePath: "/workspace/Entry.ets",
      recentPaths: [],
      readinessCursorAvailable: true,
      result: {
        candidates: [candidate("text", "width"), candidate("class", "Entry")],
        explain: ["reason:missing"],
      },
    });

    expect(result.patch.candidates.map((item) => item.title)).toEqual(["Entry"]);
    expect(result.missReport).toBeNull();
  });

  it("requests entity miss reporting when no visible candidates are available", () => {
    const result = buildEntitySearchApplication({
      query: "Missing",
      scope: "all",
      displayLimit: 10,
      activePath: null,
      recentPaths: [],
      readinessCursorAvailable: false,
      result: {
        candidates: [candidate("text", "Missing")],
        explain: ["reason:missing"],
      },
    });

    expect(result.patch.candidates).toEqual([]);
    expect(result.missReport).toEqual({ query: "Missing", explain: ["reason:missing"] });
  });

  it("builds text result patches and preview/miss signals", () => {
    const result = buildTextSearchApplication({
      mode: "find",
      query: "width",
      result: { result: textResult([]), suppressMissExplain: false },
    });

    expect(result.patch.result.matches).toEqual([]);
    expect(result.patch.selectedIndex).toBe(0);
    expect(result.previewIndex).toBe(0);
    expect(result.missReport).toMatchObject({ mode: "find", query: "width", suppressMissExplain: false });
  });
});

function candidate(source: SearchCandidate["source"], title: string): SearchCandidate {
  return {
    id: `${source}:${title}`,
    source,
    kind: source,
    title,
    subtitle: title,
    path: `/workspace/${title}.ets`,
    line: 1,
    column: 1,
    score: 1,
    freshness: "ready",
  };
}

function textResult(summaries: string[]): WorkspaceTextSearchResult {
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
