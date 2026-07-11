import { describe, expect, it } from "vitest";
import {
  buildTextSearchResultPatch,
  executeSearchTextQuery,
  planSearchTextQuery,
  shouldExplainTextSearchMiss,
} from "@/features/search/search-text-query-session";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

const plainOptions = { caseSensitive: false, wholeWord: false };

describe("search text query session", () => {
  it("clears short queries before any backend plan", () => {
    expect(planSearchTextQuery({
      query: "a",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: true,
    })).toEqual({ kind: "clear", query: "a" });
  });

  it("uses indexed text facade for plain clean text queries", () => {
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: true,
    })).toEqual({ kind: "indexed", query: "width" });
  });

  it("falls back when text options or dirty documents require live content", () => {
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: { caseSensitive: true, wholeWord: false },
      dirty: false,
      indexedAvailable: true,
    }).kind).toBe("fallback");
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: true,
      indexedAvailable: true,
    }).kind).toBe("fallback");
  });

  it("falls back for regex queries or missing indexed support", () => {
    expect(planSearchTextQuery({
      query: "/width/",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: true,
    }).kind).toBe("fallback");
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: false,
    }).kind).toBe("fallback");
  });

  it("executes indexed text queries and suppresses miss explain while not ready", async () => {
    const readiness = readinessState("partial");
    const result = await executeSearchTextQuery({
      plan: { kind: "indexed", query: "width" },
      runIndexed: async () => ({ items: [candidate()], readiness }),
      runFallback: async () => textResult("fallback"),
      convertIndexed: () => textResult("indexed"),
      onIndexedReadiness: (next) => expect(next).toBe(readiness),
    });

    expect(result.result.matches[0]?.summary).toBe("indexed");
    expect(result.suppressMissExplain).toBe(true);
  });

  it("falls back when indexed readiness is missing and empty", async () => {
    const result = await executeSearchTextQuery({
      plan: { kind: "indexed", query: "width" },
      runIndexed: async () => ({ items: [], readiness: readinessState("missing") }),
      runFallback: async () => textResult("fallback"),
      convertIndexed: () => textResult("indexed"),
      onIndexedReadiness: () => undefined,
    });

    expect(result.result.matches[0]?.summary).toBe("fallback");
    expect(result.suppressMissExplain).toBe(false);
  });

  it("executes fallback plans directly", async () => {
    const result = await executeSearchTextQuery({
      plan: { kind: "fallback", query: "width" },
      runIndexed: async () => ({ items: [candidate()], readiness: readinessState("ready") }),
      runFallback: async () => textResult("fallback"),
      convertIndexed: () => textResult("indexed"),
      onIndexedReadiness: () => {
        throw new Error("indexed readiness should not be used");
      },
    });

    expect(result.result.matches[0]?.summary).toBe("fallback");
  });

  it("builds the result patch for a fresh text result page", () => {
    const result = { ...textResult("page"), nextCursor: { pathIndex: 1, lineIndex: 2 } };

    expect(buildTextSearchResultPatch(result)).toMatchObject({
      result,
      previewContent: null,
      selectedIndex: 0,
      entityNextCursor: null,
      textNextCursor: { pathIndex: 1, lineIndex: 2 },
      textPageLoading: false,
    });
  });

  it("explains text misses only when the result is empty and eligible", () => {
    expect(shouldExplainTextSearchMiss(textResult("hit"), false, "width")).toBe(false);
    expect(shouldExplainTextSearchMiss({ ...textResult("hit"), matches: [] }, false, "width")).toBe(true);
    expect(shouldExplainTextSearchMiss({ ...textResult("hit"), matches: [] }, true, "width")).toBe(false);
    expect(shouldExplainTextSearchMiss({
      query: { kind: "invalid" as const, query: "/(/", message: "invalid" },
      matches: [],
    }, false, "/(/")).toBe(false);
  });
});

function candidate(): SearchCandidate {
  return {
    id: "text:/workspace/A.ets:1:1",
    source: "text",
    kind: "text",
    title: "width",
    subtitle: "A.ets",
    path: "/workspace/A.ets",
    line: 1,
    column: 1,
    score: 1,
    freshness: "ready",
  };
}

function readinessState(state: "ready" | "partial" | "missing") {
  return {
    rootPath: "/workspace",
    requestedGeneration: 1,
    servedGeneration: state === "ready" ? 1 : null,
    state,
    retryable: state !== "ready",
  };
}

function textResult(summary: string) {
  return {
    query: { kind: "text" as const, query: "width" },
    matches: [{
      path: "/workspace/A.ets",
      relativePath: "A.ets",
      fileName: "A.ets",
      line: 1,
      column: 1,
      summary,
      preview: summary,
      previewStart: 0,
      previewEnd: summary.length,
      contextBefore: [],
      contextAfter: [],
    }],
  };
}
