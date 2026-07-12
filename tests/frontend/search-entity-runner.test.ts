import { describe, expect, it, vi } from "vitest";
import { runSearchEntityQuery } from "@/components/layout/search-entity-runner";
import type { WorkspaceIndexQueryEnvelope } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search entity runner", () => {
  it("runs readiness-first entity search through tracked requests", async () => {
    const envelope: WorkspaceIndexQueryEnvelope<SearchCandidate> = {
      items: [candidate("file", "Entry.ets")],
      readiness: readinessState(),
      explain: ["query:ready"],
      nextCursor: 4,
    };
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => envelope);
    const replaceQueryReadiness = vi.fn();
    const patchSearchSession = vi.fn();
    const reportMiss = vi.fn();
    const trackQuery = vi.fn(async ({ request, apply }) => {
      apply(await request, 9);
    });

    runSearchEntityQuery({
      requestId: 9,
      query: "Entry",
      rootPath: "/workspace",
      scope: "all",
      displayLimit: 25,
      minimumQueryLength: 2,
      activePath: "/workspace/Entry.ets",
      recentPaths: [],
      queryIndexCandidates: vi.fn(),
      workspaceApi: { queryWorkspaceCandidatesWithReadiness },
      replaceQueryReadiness,
      trackQuery,
      clearSearchResults: vi.fn(),
      patchSearchSession,
      recordUiInteraction: vi.fn(),
      reportMiss,
    });
    await vi.waitFor(() => {
      expect(patchSearchSession).toHaveBeenCalled();
    });

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith("/workspace", "Entry", "all", 26);
    expect(replaceQueryReadiness).toHaveBeenCalledWith(envelope.readiness);
    expect(patchSearchSession).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({ title: "Entry.ets" })],
      entityNextCursor: 4,
    }));
    expect(reportMiss).not.toHaveBeenCalled();
  });

  it("does not run without a workspace root", () => {
    const trackQuery = vi.fn();
    const clearSearchResults = vi.fn();

    runSearchEntityQuery({
      requestId: 1,
      query: "Entry",
      rootPath: null,
      scope: "all",
      displayLimit: 25,
      minimumQueryLength: 2,
      activePath: null,
      recentPaths: [],
      queryIndexCandidates: vi.fn(),
      workspaceApi: {},
      replaceQueryReadiness: vi.fn(),
      trackQuery,
      clearSearchResults,
      patchSearchSession: vi.fn(),
      recordUiInteraction: vi.fn(),
      reportMiss: vi.fn(),
    });

    expect(trackQuery).not.toHaveBeenCalled();
    expect(clearSearchResults).not.toHaveBeenCalled();
  });
});

function candidate(source: SearchCandidate["source"], title: string): SearchCandidate {
  return {
    id: `${source}:${title}`,
    source,
    kind: source,
    title,
    subtitle: title,
    path: `/workspace/${title}`,
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
