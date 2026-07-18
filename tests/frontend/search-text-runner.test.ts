import { describe, expect, it, vi } from "vitest";
import { runSearchTextQuery } from "@/components/layout/search-text-runner";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryEnvelope } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search text runner", () => {
  it("uses indexed text search for clean plain queries", async () => {
    const envelope: WorkspaceIndexQueryEnvelope<SearchCandidate> = {
      items: [textCandidate()],
      readiness: readinessState("ready"),
    };
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => envelope);
    const replaceQueryReadiness = vi.fn();
    const runFallback = vi.fn(async () => textResult("fallback"));
    const patchSearchSession = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 8);
    });

    runSearchTextQuery({
      requestId: 8,
      mode: "find",
      query: "width",
      rootPath: "/workspace",
      minimumQueryLength: 2,
      options: { caseSensitive: false, wholeWord: false },
      dirty: false,
      workspaceApi: { queryWorkspaceCandidatesWithReadiness },
      runFallback,
      replaceQueryReadiness,
      trackQuery,
      clearSearchResults: vi.fn(),
      patchSearchSession,
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview: vi.fn(),
      reportMiss: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(patchSearchSession).toHaveBeenCalledWith(expect.objectContaining({
        result: expect.objectContaining({ matches: [expect.objectContaining({ summary: "width" })] }),
      }));
    });

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith(
      "/workspace",
      "width",
      "text",
      50,
      null,
      undefined,
      8,
      1_500,
    );
    expect(replaceQueryReadiness).toHaveBeenCalledWith(envelope.readiness);
    expect(runFallback).not.toHaveBeenCalled();
  });

  it("falls back when dirty documents require live content", async () => {
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [textCandidate()],
      readiness: readinessState("ready"),
    }));
    const runFallback = vi.fn(async () => textResult("fallback"));
    const patchSearchSession = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 12);
    });

    runSearchTextQuery({
      requestId: 12,
      mode: "find",
      query: "width",
      rootPath: "/workspace",
      minimumQueryLength: 2,
      options: { caseSensitive: false, wholeWord: false },
      dirty: true,
      workspaceApi: { queryWorkspaceCandidatesWithReadiness },
      runFallback,
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      clearSearchResults: vi.fn(),
      patchSearchSession,
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview: vi.fn(),
      reportMiss: vi.fn(),
    });
    await vi.waitFor(() => {
      expect(patchSearchSession).toHaveBeenCalledWith(expect.objectContaining({
        result: expect.objectContaining({ matches: [expect.objectContaining({ summary: "fallback" })] }),
      }));
    });

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();
    expect(runFallback).toHaveBeenCalledWith("width", true, 12);
  });

  it("does not run without a workspace root", () => {
    const trackQuery = vi.fn();

    runSearchTextQuery({
      requestId: 1,
      mode: "find",
      query: "width",
      rootPath: null,
      minimumQueryLength: 2,
      options: { caseSensitive: false, wholeWord: false },
      dirty: false,
      workspaceApi: {},
      runFallback: vi.fn(),
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      clearSearchResults: vi.fn(),
      patchSearchSession: vi.fn(),
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview: vi.fn(),
      reportMiss: vi.fn(),
    });

    expect(trackQuery).not.toHaveBeenCalled();
  });
});

function textCandidate(): SearchCandidate {
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
    signature: "  width: 100",
  };
}

function readinessState(state: "ready" | "partial") {
  return {
    rootPath: "/workspace",
    requestedGeneration: 1,
    servedGeneration: state === "ready" ? 1 : null,
    state,
    retryable: state !== "ready",
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
