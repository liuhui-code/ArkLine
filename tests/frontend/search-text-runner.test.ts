import { describe, expect, it, vi } from "vitest";
import { runSearchTextQuery } from "@/components/layout/search-text-runner";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryEnvelope } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search text runner", () => {
  it("uses indexed candidate search for Search Everywhere text scope", async () => {
    const envelope: WorkspaceIndexQueryEnvelope<SearchCandidate> = {
      contractVersion: 1,
      capability: "searchEverywhere",
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
      mode: "searchEverywhere",
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

  it("routes Find in Files through the cancellable content channel", async () => {
    const queryWorkspaceCandidatesWithReadiness = vi.fn();
    const runFallback = vi.fn(async () => textResult("native-content"));
    const patchSearchSession = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 9);
    });

    runSearchTextQuery({
      requestId: 9,
      mode: "find",
      query: "width",
      rootPath: "/workspace",
      minimumQueryLength: 2,
      options: { caseSensitive: true, wholeWord: false },
      dirty: false,
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
        result: expect.objectContaining({
          matches: [expect.objectContaining({ summary: "native-content" })],
        }),
      }));
    });

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();
    expect(runFallback).toHaveBeenCalledWith("width", false, 9);
  });

  it("applies current streaming batches incrementally and ignores stale generations", async () => {
    const runFallback = vi.fn(async () => textResult("fallback"));
    const patchSearchSession = vi.fn();
    const streamWorkspaceText = vi.fn(async (_request, onEvent) => {
      onEvent({ event: "started", generation: 9 });
      onEvent({ event: "batch", generation: 8, sequence: 0, result: textResult("stale") });
      onEvent({ event: "batch", generation: 9, sequence: 0, result: textResult("first") });
      const second = textResult("second");
      second.matches[0]!.line = 2;
      onEvent({ event: "batch", generation: 9, sequence: 1, result: second });
      onEvent({ event: "finished", generation: 9, sequence: 2, status: "complete" });
      return { generation: 9, sequence: 2, status: "complete" as const };
    });
    const trackQuery = vi.fn(async ({ request, apply }) => apply(await request, 9));

    runSearchTextQuery({
      requestId: 9,
      mode: "find",
      query: "width",
      rootPath: "/workspace",
      minimumQueryLength: 2,
      options: { caseSensitive: true, wholeWord: false },
      dirty: false,
      workspaceApi: { streamWorkspaceText },
      runFallback,
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      isCurrentQuery: (generation) => generation === 9,
      clearSearchResults: vi.fn(),
      patchSearchSession,
      recordUiInteraction: vi.fn(),
      scheduleSelectedPreview: vi.fn(),
      reportMiss: vi.fn(),
    });
    await vi.waitFor(() => expect(streamWorkspaceText).toHaveBeenCalledTimes(1));

    const resultPatches = patchSearchSession.mock.calls
      .map(([patch]) => patch.result)
      .filter(Boolean);
    expect(resultPatches).toHaveLength(2);
    expect((resultPatches.at(-1) as WorkspaceTextSearchResult).matches.map((match) => match.summary)).toEqual(["first", "second"]);
    expect(runFallback).not.toHaveBeenCalled();
  });

  it("stops loading when a streaming sequence has a gap", async () => {
    const patchSearchSession = vi.fn();
    const onStreamError = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => apply(await request, 3));

    runSearchTextQuery({
      requestId: 3,
      mode: "find",
      query: "width",
      rootPath: "/workspace",
      minimumQueryLength: 2,
      options: { caseSensitive: false, wholeWord: false },
      dirty: false,
      workspaceApi: {
        streamWorkspaceText: async (_request, onEvent) => {
          onEvent({ event: "started", generation: 3 });
          onEvent({ event: "batch", generation: 3, sequence: 1, result: textResult("gap") });
          return { generation: 3, sequence: 1, status: "failed" as const };
        },
      },
      runFallback: vi.fn(),
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      isCurrentQuery: (generation) => generation === 3,
      clearSearchResults: vi.fn(),
      patchSearchSession,
      scheduleSelectedPreview: vi.fn(),
      reportMiss: vi.fn(),
      onStreamError,
    });
    await vi.waitFor(() => expect(trackQuery).toHaveBeenCalled());

    expect(patchSearchSession).toHaveBeenCalledWith({ textPageLoading: false });
    expect(onStreamError).toHaveBeenCalledWith("Workspace text search stream sequence gap");
  });

  it("falls back when dirty documents require live content", async () => {
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [textCandidate()],
      readiness: readinessState("ready"),
    }));
    const runFallback = vi.fn(async () => textResult("fallback"));
    const streamWorkspaceText = vi.fn(async () => ({ generation: 12, sequence: 0, status: "cancelled" as const }));
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
      workspaceApi: { queryWorkspaceCandidatesWithReadiness, streamWorkspaceText },
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
    expect(streamWorkspaceText).not.toHaveBeenCalled();
    expect(runFallback).toHaveBeenCalledWith("width", true, 12);
  });

  it("uses the command terminal when the channel terminal arrives late", async () => {
    const patchSearchSession = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => apply(await request, 14));

    runSearchTextQuery({
      requestId: 14,
      mode: "find",
      query: "width",
      rootPath: "/workspace",
      minimumQueryLength: 2,
      options: { caseSensitive: false, wholeWord: false },
      dirty: false,
      workspaceApi: {
        streamWorkspaceText: async (_request, onEvent) => {
          onEvent({ event: "started", generation: 14 });
          onEvent({ event: "batch", generation: 14, sequence: 0, result: textResult("first") });
          return { generation: 14, sequence: 1, status: "complete" };
        },
      },
      runFallback: vi.fn(),
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      isCurrentQuery: (generation) => generation === 14,
      clearSearchResults: vi.fn(),
      patchSearchSession,
      scheduleSelectedPreview: vi.fn(),
      reportMiss: vi.fn(),
    });

    await vi.waitFor(() => {
      expect(patchSearchSession).toHaveBeenCalledWith(expect.objectContaining({ textPageLoading: false }));
    });
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
