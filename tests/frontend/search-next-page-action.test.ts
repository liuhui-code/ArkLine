import { describe, expect, it, vi } from "vitest";
import { createSearchNextPageAction } from "@/components/layout/search-next-page-action";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("search next page action", () => {
  it("loads the next entity page using the latest session and query generation", async () => {
    const sessionStore = createSearchSessionStore();
    const interactionRuntime = createSearchInteractionRuntime();
    const queryEntityPage = vi.fn(async () => ({
      items: [candidate("Next")],
      readiness: readinessState(),
      nextCursor: null,
    }));
    interactionRuntime.startQuery("searchEverywhere");
    sessionStore.patch({
      candidates: [candidate("Entry")],
      entityNextCursor: 1,
    });
    const loadNextPage = createSearchNextPageAction({
      getMode: () => "searchEverywhere",
      sessionStore,
      getRootPath: () => "/workspace",
      getQuery: () => "Entry",
      getScope: () => "all",
      displayLimit: 25,
      interactionRuntime,
      queryEntityPage,
      runTextPage: vi.fn(),
      hasDirtyDocuments: () => false,
      scheduleSelectedPreview: vi.fn(),
    });

    await loadNextPage(1);

    expect(queryEntityPage).toHaveBeenCalledWith("/workspace", "Entry", "all", 25, 1);
    expect(sessionStore.getSnapshot().candidates.map((item) => item.title)).toEqual(["Entry", "Next"]);
    expect(sessionStore.getSnapshot().selectedIndex).toBe(1);
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
