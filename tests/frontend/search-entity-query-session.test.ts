import { describe, expect, it } from "vitest";
import {
  buildSearchEntityPatch,
  filterLegacySearchEntityCandidates,
} from "@/components/layout/search-entity-query-session";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search entity query session", () => {
  it("filters legacy candidates by scope", () => {
    const result = filterLegacySearchEntityCandidates([
      candidate("file", "Entry.ets"),
      candidate("class", "Entry"),
    ], "classes");

    expect(result.candidates.map((item) => item.source)).toEqual(["class"]);
  });

  it("builds ordered capped search entity patches", () => {
    const { patch, visibleCount } = buildSearchEntityPatch({
      candidates: [
        candidate("text", "width"),
        candidate("file", "Other.ets", "/workspace/Other.ets"),
        candidate("file", "Entry.ets", "/workspace/Entry.ets"),
      ],
      query: "Entry",
      scope: "all",
      displayLimit: 1,
      activePath: "/workspace/Entry.ets",
      recentPaths: [],
      nextCursor: 9,
      readinessCursorAvailable: true,
    });

    expect(visibleCount).toBe(2);
    expect(patch.candidates.map((item) => item.title)).toEqual(["Entry.ets"]);
    expect(patch.entityNextCursor).toBe(1);
    expect(patch.truncationNotice).toContain("Showing 1 of at least 2 all result");
    expect(patch.result.query).toEqual({ kind: "text", query: "Entry" });
  });

  it("uses backend next cursor when readiness paging is not available", () => {
    const { patch } = buildSearchEntityPatch({
      candidates: [candidate("file", "Entry.ets")],
      query: "Entry",
      scope: "all",
      displayLimit: 20,
      activePath: null,
      recentPaths: [],
      nextCursor: 12,
      readinessCursorAvailable: false,
    });

    expect(patch.entityNextCursor).toBe(12);
  });
});

function candidate(source: SearchCandidate["source"], title: string, path = `/workspace/${title}`): SearchCandidate {
  return {
    id: `${source}:${title}`,
    source,
    kind: source,
    title,
    subtitle: title,
    path,
    line: 1,
    column: 1,
    score: 1,
    freshness: "ready",
  };
}
