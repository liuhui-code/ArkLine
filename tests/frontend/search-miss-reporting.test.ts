import { describe, expect, it, vi } from "vitest";
import {
  reportSearchEverywhereMiss,
  reportTextSearchMiss,
} from "@/components/layout/search-miss-reporting";

describe("search miss reporting", () => {
  it("uses envelope explain before running a separate Search Everywhere explain query", () => {
    const explainIndexMiss = vi.fn(async () => "fallback");
    const recordRecentQueryExplain = vi.fn();
    const onStatusChange = vi.fn();

    reportSearchEverywhereMiss({
      requestId: 3,
      query: "missingThing",
      explain: ["reason:Current query is waiting for the symbol index"],
      isCurrentQuery: () => true,
      explainIndexMiss,
      recordRecentQueryExplain,
      onStatusChange,
    });

    expect(explainIndexMiss).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith("Search Everywhere miss: Current query is waiting for the symbol index");
    expect(recordRecentQueryExplain).toHaveBeenCalledWith({
      kind: "search",
      query: "missingThing",
      message: "Search Everywhere miss: Current query is waiting for the symbol index",
      explain: ["reason:Current query is waiting for the symbol index"],
    });
  });

  it("reports fallback Search Everywhere explain only for the current request", async () => {
    const onStatusChange = vi.fn();

    await reportSearchEverywhereMiss({
      requestId: 7,
      query: "missingThing",
      isCurrentQuery: () => false,
      explainIndexMiss: vi.fn(async () => "No indexed evidence"),
      recordRecentQueryExplain: vi.fn(),
      onStatusChange,
    });

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("reports text miss explain when not suppressed", async () => {
    const onStatusChange = vi.fn();

    await reportTextSearchMiss({
      mode: "find",
      requestId: 9,
      query: "missingText",
      result: { query: { kind: "text", query: "missingText" }, matches: [] },
      suppressMissExplain: false,
      isCurrentQuery: () => true,
      explainIndexMiss: vi.fn(async () => "No indexed evidence"),
      onStatusChange,
    });

    expect(onStatusChange).toHaveBeenCalledWith("Find in Files miss: No indexed evidence");
  });

  it("does not report text miss explain for suppressed indexed misses", async () => {
    const explainIndexMiss = vi.fn(async () => "No indexed evidence");

    await reportTextSearchMiss({
      mode: "find",
      requestId: 9,
      query: "missingText",
      result: { query: { kind: "text", query: "missingText" }, matches: [] },
      suppressMissExplain: true,
      isCurrentQuery: () => true,
      explainIndexMiss,
      onStatusChange: vi.fn(),
    });

    expect(explainIndexMiss).not.toHaveBeenCalled();
  });
});
