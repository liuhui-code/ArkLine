import { describe, expect, it, vi } from "vitest";
import { loadNextSearchPage } from "@/components/layout/search-next-page-loader";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search next page loader", () => {
  it("loads and appends the next entity page", async () => {
    const patchSearchSession = vi.fn();
    const queryEntityPage = vi.fn(async () => ({
      items: [candidate("Next.ets")],
      readiness: readiness(),
      nextCursor: null,
    }));

    await loadNextSearchPage({
      mode: "searchEverywhere",
      session: { ...session(), candidates: [candidate("Current.ets")], entityNextCursor: 24, selectedIndex: 23 },
      rootPath: "/workspace",
      query: "Entry",
      scope: "all",
      rankingContext: { activePath: "/workspace/Current.ets", recentPaths: ["/workspace/Recent.ets"] },
      displayLimit: 24,
      requestId: 7,
      selectIndexAfterLoad: 24,
      queryEntityPage,
      runTextPage: vi.fn(),
      hasDirtyDocuments: vi.fn(),
      isCurrentQuery: () => true,
      patchSearchSession,
      scheduleSelectedPreview: vi.fn(),
    });

    expect(queryEntityPage).toHaveBeenCalledWith(
      "/workspace",
      "Entry",
      "all",
      24,
      24,
      { activePath: "/workspace/Current.ets", recentPaths: ["/workspace/Recent.ets"] },
    );
    expect(patchSearchSession).toHaveBeenNthCalledWith(1, { textPageLoading: true });
    expect(patchSearchSession).toHaveBeenLastCalledWith(expect.objectContaining({
      candidates: [candidate("Current.ets"), candidate("Next.ets")],
      entityNextCursor: null,
      selectedIndex: 24,
    }));
  });

  it("does not append stale entity pages", async () => {
    const patchSearchSession = vi.fn();

    await loadNextSearchPage({
      mode: "searchEverywhere",
      session: { ...session(), candidates: [candidate("Current.ets")], entityNextCursor: 24 },
      rootPath: "/workspace",
      query: "Entry",
      scope: "all",
      displayLimit: 24,
      requestId: 7,
      queryEntityPage: async () => ({ items: [candidate("Stale.ets")], readiness: readiness(), nextCursor: null }),
      runTextPage: vi.fn(),
      hasDirtyDocuments: vi.fn(),
      isCurrentQuery: () => false,
      patchSearchSession,
      scheduleSelectedPreview: vi.fn(),
    });

    expect(patchSearchSession).toHaveBeenCalledTimes(1);
    expect(patchSearchSession).toHaveBeenCalledWith({ textPageLoading: true });
  });

  it("loads and appends text pages with dirty state and preview scheduling", async () => {
    const patchSearchSession = vi.fn();
    const scheduleSelectedPreview = vi.fn();
    const runTextPage = vi.fn(async () => textResult(["second"]));

    await loadNextSearchPage({
      mode: "find",
      session: {
        ...session(),
        result: textResult(["first"]),
        textNextCursor: { pathIndex: 1, lineIndex: 2 },
        selectedIndex: 0,
      },
      rootPath: "/workspace",
      query: "width",
      scope: "all",
      displayLimit: 24,
      requestId: 9,
      selectIndexAfterLoad: 1,
      queryEntityPage: undefined,
      runTextPage,
      hasDirtyDocuments: () => true,
      isCurrentQuery: () => true,
      patchSearchSession,
      scheduleSelectedPreview,
    });

    expect(runTextPage).toHaveBeenCalledWith("width", true, 9, { pathIndex: 1, lineIndex: 2 });
    expect(patchSearchSession).toHaveBeenLastCalledWith(expect.objectContaining({
      result: expect.objectContaining({ matches: expect.arrayContaining([
        expect.objectContaining({ summary: "first" }),
        expect.objectContaining({ summary: "second" }),
      ]) }),
      selectedIndex: 1,
      textPageLoading: false,
    }));
    expect(scheduleSelectedPreview).toHaveBeenCalledWith(1);
  });

  it("ignores requests while loading or without a cursor", async () => {
    const patchSearchSession = vi.fn();
    const queryEntityPage = vi.fn();

    await loadNextSearchPage({
      mode: "searchEverywhere",
      session: { ...session(), textPageLoading: true, entityNextCursor: 24 },
      rootPath: "/workspace",
      query: "Entry",
      scope: "all",
      displayLimit: 24,
      requestId: 7,
      queryEntityPage,
      runTextPage: vi.fn(),
      hasDirtyDocuments: vi.fn(),
      isCurrentQuery: () => true,
      patchSearchSession,
      scheduleSelectedPreview: vi.fn(),
    });

    expect(queryEntityPage).not.toHaveBeenCalled();
    expect(patchSearchSession).not.toHaveBeenCalled();
  });
});

function session(): SearchSessionSnapshot {
  return {
    result: textResult([]),
    candidates: [],
    truncationNotice: null,
    selectedIndex: 0,
    previewContent: null,
    entityNextCursor: null,
    textNextCursor: null,
    textPageLoading: false,
  };
}

function candidate(title: string): SearchCandidate {
  return {
    id: title,
    source: "file",
    kind: "file",
    title,
    subtitle: title,
    path: `/workspace/${title}`,
    line: 1,
    column: 1,
    score: 1,
    freshness: "ready",
  };
}

function textResult(summaries: string[]) {
  return {
    query: { kind: "text" as const, query: "width" },
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

function readiness() {
  return {
    rootPath: "/workspace",
    requestedGeneration: 1,
    servedGeneration: 1,
    state: "ready" as const,
    retryable: false,
  };
}
