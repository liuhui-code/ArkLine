import { describe, expect, it, vi } from "vitest";
import { createSearchRunActions } from "@/components/layout/search-run-actions";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search run actions", () => {
  it("runs entity search with current workspace query dependencies", async () => {
    const sessionStore = createSearchSessionStore();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate("Entry")],
      readiness: readinessState(),
      nextCursor: null,
    }));
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 3);
    });
    const actions = createSearchRunActions({
      getQuery: () => "Entry",
      getRootPath: () => "/workspace",
      getMode: () => "searchEverywhere",
      getScope: () => "all",
      getOptions: () => ({ caseSensitive: false, wholeWord: false }),
      getDirty: () => false,
      displayLimit: 25,
      minimumQueryLength: 2,
      activePath: "/workspace/Entry.ets",
      recentPaths: [],
      queryIndexCandidates: vi.fn(),
      workspaceApi: { queryWorkspaceCandidatesWithReadiness },
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      clearSearchResults: vi.fn(),
      patchSearchSession: sessionStore.patch,
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview: vi.fn(),
      reportEntityMiss: vi.fn(),
      reportTextMiss: vi.fn(),
      runFallback: vi.fn(),
    });

    actions.runEntitySearch(3);
    await vi.waitFor(() => {
      expect(sessionStore.getSnapshot().candidates).toHaveLength(1);
    });

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith("/workspace", "Entry", "all", 26);
  });

  it("runs text search with dirty fallback when live content is required", async () => {
    const sessionStore = createSearchSessionStore();
    const runFallback = vi.fn(async () => textResult("fallback"));
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 4);
    });
    const actions = createSearchRunActions({
      getQuery: () => "width",
      getRootPath: () => "/workspace",
      getMode: () => "find",
      getScope: () => "all",
      getOptions: () => ({ caseSensitive: false, wholeWord: false }),
      getDirty: () => true,
      displayLimit: 25,
      minimumQueryLength: 2,
      activePath: null,
      recentPaths: [],
      queryIndexCandidates: vi.fn(),
      workspaceApi: {},
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      clearSearchResults: vi.fn(),
      patchSearchSession: sessionStore.patch,
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview: vi.fn(),
      reportEntityMiss: vi.fn(),
      reportTextMiss: vi.fn(),
      runFallback,
    });

    actions.runTextSearch(4);
    await vi.waitFor(() => {
      expect(sessionStore.getSnapshot().result.matches).toHaveLength(1);
    });

    expect(runFallback).toHaveBeenCalledWith("width", true, 4);
  });
});

function candidate(title: string): SearchCandidate {
  return {
    id: `file:${title}`,
    source: "file",
    kind: "file",
    title,
    subtitle: title,
    path: `/workspace/${title}.ets`,
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

function textResult(summary: string): WorkspaceTextSearchResult {
  return {
    query: { kind: "text", query: "width" },
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
