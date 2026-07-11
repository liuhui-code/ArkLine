import { describe, expect, it, vi } from "vitest";
import {
  runEntitySearchRequest,
  runTextSearchRequest,
} from "@/components/layout/search-request-runner";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search request runner", () => {
  it("clears short entity queries without starting tracked work", () => {
    const trackQuery = vi.fn();
    const clearSearchResults = vi.fn();

    runEntitySearchRequest({
      requestId: 1,
      query: "a",
      minimumQueryLength: 2,
      trackQuery,
      clearSearchResults,
      request: async () => ({ candidates: [] }),
      application: entityApplication(),
      patchSearchSession: vi.fn(),
      recordUiInteraction: vi.fn(),
      reportMiss: vi.fn(),
    });

    expect(clearSearchResults).toHaveBeenCalledWith("a");
    expect(trackQuery).not.toHaveBeenCalled();
  });

  it("applies tracked entity results and reports misses", async () => {
    const patchSearchSession = vi.fn();
    const reportMiss = vi.fn();
    const recordUiInteraction = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 7);
    });

    runEntitySearchRequest({
      requestId: 7,
      query: "Missing",
      minimumQueryLength: 2,
      trackQuery,
      clearSearchResults: vi.fn(),
      request: async () => ({ candidates: [candidate("text", "Missing")], explain: ["reason:missing"] }),
      application: entityApplication(),
      patchSearchSession,
      recordUiInteraction,
      reportMiss,
      now: () => 100,
    });
    await Promise.resolve();

    expect(recordUiInteraction).toHaveBeenCalledWith("searchEverywhere", "Missing", 100, 100);
    expect(patchSearchSession).toHaveBeenCalledWith(expect.objectContaining({ candidates: [] }));
    expect(reportMiss).toHaveBeenCalledWith(7, { query: "Missing", explain: ["reason:missing"] });
  });

  it("clears short text queries after resetting entity state", () => {
    const patchSearchSession = vi.fn();
    const clearSearchResults = vi.fn();
    const trackQuery = vi.fn();

    runTextSearchRequest({
      requestId: 3,
      mode: "find",
      query: "a",
      minimumQueryLength: 2,
      trackQuery,
      clearSearchResults,
      patchSearchSession,
      request: async () => ({ result: textResult([]), suppressMissExplain: false }),
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview: vi.fn(),
      reportMiss: vi.fn(),
    });

    expect(patchSearchSession).toHaveBeenCalledWith({ candidates: [], truncationNotice: null });
    expect(clearSearchResults).toHaveBeenCalledWith("a");
    expect(trackQuery).not.toHaveBeenCalled();
  });

  it("applies tracked text results and schedules preview", async () => {
    const patchSearchSession = vi.fn();
    const scheduleSelectedPreview = vi.fn();
    const reportMiss = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 4);
    });

    runTextSearchRequest({
      requestId: 4,
      mode: "find",
      query: "width",
      minimumQueryLength: 2,
      trackQuery,
      clearSearchResults: vi.fn(),
      patchSearchSession,
      request: async () => ({ result: textResult(["width"]), suppressMissExplain: false }),
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview,
      reportMiss,
    });
    await Promise.resolve();

    expect(patchSearchSession).toHaveBeenCalledWith(expect.objectContaining({ selectedIndex: 0 }));
    expect(scheduleSelectedPreview).toHaveBeenCalledWith(0);
    expect(reportMiss).toHaveBeenCalledWith(4, expect.objectContaining({ query: "width" }));
  });
});

function entityApplication() {
  return {
    scope: "all" as const,
    displayLimit: 10,
    activePath: null,
    recentPaths: [],
    readinessCursorAvailable: false,
  };
}

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
