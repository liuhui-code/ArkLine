import { describe, expect, it } from "vitest";
import {
  buildSearchEntityQueryRequest,
  buildSearchEntityAppendPatch,
  buildSearchEntityPatch,
  executeSearchEntityQuery,
  filterLegacySearchEntityCandidates,
} from "@/components/layout/search-entity-query-session";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search entity query session", () => {
  it("builds readiness-first entity query requests", async () => {
    const envelope = {
      items: [candidate("file", "Entry.ets")],
      readiness: readinessState(),
      explain: ["reason:ready"],
      nextCursor: 5,
    };
    const readiness = async () => envelope;
    const indexed = async () => [candidate("class", "Fallback")];
    const observed: unknown[] = [];

    const input = buildSearchEntityQueryRequest({
      query: "Entry",
      scope: "all",
      limit: 25,
      runReadiness: readiness,
      runIndexed: indexed,
      runLegacy: undefined,
      runLocal: () => [],
      onReadiness: (value) => observed.push(value),
    });
    const result = await executeSearchEntityQuery(input);

    expect(result).toEqual({ candidates: envelope.items, explain: ["reason:ready"], nextCursor: 5 });
    expect(observed).toEqual([envelope]);
  });

  it("builds local fallback entity query requests", async () => {
    const input = buildSearchEntityQueryRequest({
      query: "Entry",
      scope: "classes",
      limit: 25,
      runReadiness: undefined,
      runIndexed: undefined,
      runLegacy: undefined,
      runLocal: () => [candidate("class", "Entry")],
      onReadiness: () => undefined,
    });

    await expect(executeSearchEntityQuery(input)).resolves.toEqual({
      candidates: [candidate("class", "Entry")],
    });
  });

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

  it("executes readiness entity queries and reports readiness", async () => {
    const envelope = {
      items: [candidate("file", "Entry.ets")],
      readiness: readinessState(),
      explain: ["query:entity"],
      nextCursor: 2,
    };
    const result = await executeSearchEntityQuery({
      runReadiness: async () => envelope,
      runLocal: () => [],
      scope: "all",
      onReadiness: (next) => expect(next).toBe(envelope),
    });

    expect(result).toMatchObject({ candidates: envelope.items, explain: ["query:entity"], nextCursor: 2 });
  });

  it("executes legacy entity queries through scope filtering", async () => {
    const result = await executeSearchEntityQuery({
      runLegacy: async () => [candidate("file", "Entry.ets"), candidate("class", "Entry")],
      runLocal: () => [],
      scope: "files",
      onReadiness: () => undefined,
    });

    expect(result.candidates.map((item) => item.source)).toEqual(["file"]);
  });

  it("builds append patches for paged entity results", () => {
    const patch = buildSearchEntityAppendPatch(
      [candidate("file", "Entry.ets")],
      [candidate("text", "width"), candidate("class", "Entry")],
      10,
      1,
    );

    expect(patch.candidates.map((item) => item.source)).toEqual(["file", "class"]);
    expect(patch.entityNextCursor).toBe(10);
    expect(patch.selectedIndex).toBe(1);
    expect(patch.textPageLoading).toBe(false);
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

function readinessState() {
  return {
    rootPath: "/workspace",
    requestedGeneration: 1,
    servedGeneration: 1,
    state: "ready" as const,
    retryable: false,
  };
}
