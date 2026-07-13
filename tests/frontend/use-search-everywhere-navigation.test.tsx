import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearchEverywhereController } from "@/components/layout/use-search-everywhere-controller";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("useSearchEverywhereController navigation isolation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels pending search work before navigating from a selected candidate", async () => {
    const events: string[] = [];
    const cancelWorkspaceSearch = vi.fn(async () => {
      events.push("cancel");
    });
    const navigateToLocation = vi.fn(async () => {
      events.push("navigate");
    });
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets", line: 8, column: 3 })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ cancelWorkspaceSearch, queryWorkspaceCandidatesWithReadiness }),
      navigateToLocation,
    });

    await waitFor(() => expect(result.current.search.searchEverywhereCandidates).toHaveLength(1));

    await act(async () => {
      await result.current.search.openSelectedSearchEverywhereResult();
    });

    expect(events).toEqual(["cancel", "navigate"]);
    expect(cancelWorkspaceSearch).toHaveBeenCalledWith("/workspace", "searchEverywhere", expect.any(Number));
  });

  it("records close latency evidence", async () => {
    const recordUiInteraction = vi.fn();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets", line: 8, column: 3 })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      recordUiInteraction,
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await waitFor(() => expect(result.current.search.searchEverywhereCandidates).toHaveLength(1));

    act(() => result.current.search.resetSearchOverlayState());
    expect(recordUiInteraction).toHaveBeenCalledWith("searchClose", "Search Everywhere", expect.any(Number), expect.any(Number));
  });

  it("records jump latency evidence", async () => {
    const recordUiInteraction = vi.fn();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets", line: 8, column: 3 })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      recordUiInteraction,
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await waitFor(() => expect(result.current.search.searchEverywhereCandidates).toHaveLength(1));
    await act(async () => {
      await result.current.search.openSelectedSearchEverywhereResult();
    });
    expect(recordUiInteraction).toHaveBeenCalledWith("searchJump", "EntryAbility", expect.any(Number), expect.any(Number));
  });

  it("keeps rapid typing and deletion local until the final debounced query", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets", line: 8, column: 3 })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
      getOpenedPaths: () => ["/workspace/Opened.ets", "/workspace/Entry.ets"],
    });

    act(() => {
      for (let index = 0; index < 100; index += 1) {
        result.current.search.handleOverlayQueryChange(`Entry${index}`);
        result.current.search.handleOverlayQueryChange("");
      }
    });
    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();

    act(() => result.current.search.handleOverlayQueryChange("EntryFinal"));
    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith(
      "/workspace",
      "EntryFinal",
      "all",
      25,
      null,
      {
        activePath: "/workspace/Entry.ets",
        recentPaths: [],
        openedPaths: ["/workspace/Opened.ets", "/workspace/Entry.ets"],
      },
    );
  });

  it("does not let a stale slow query overwrite newer search results", async () => {
    vi.useFakeTimers();
    const first = deferred<CandidateEnvelope>();
    const second = deferred<CandidateEnvelope>();
    const queryWorkspaceCandidatesWithReadiness = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    act(() => result.current.search.handleOverlayQueryChange("Final"));
    await flushSearchDebounce();
    await act(async () => {
      second.resolve({
        items: [candidate({ title: "FinalAbility", path: "/workspace/FinalAbility.ets" })],
        readiness: readiness(),
        explain: [],
      });
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve({
        items: [candidate({ title: "OldEntry", path: "/workspace/OldEntry.ets" })],
        readiness: readiness(),
        explain: [],
      });
      await Promise.resolve();
    });

    expect(result.current.search.searchEverywhereCandidates.map((item) => item.title)).toEqual(["FinalAbility"]);
  });

  it("does not repopulate results after closing the search panel", async () => {
    vi.useFakeTimers();
    const pending = deferred<CandidateEnvelope>();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(() => pending.promise);
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    act(() => result.current.search.resetSearchOverlayState());
    await act(async () => {
      pending.resolve({
        items: [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets" })],
        readiness: readiness(),
        explain: [],
      });
      await Promise.resolve();
    });

    expect(result.current.search.searchEverywhereCandidates).toHaveLength(0);
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  const stableWorkspaceApi = overrides.workspaceApi ?? workspaceApi({});
  const stableWorkspace = workspace();
  return renderHook(() => {
    const [overlay, setOverlay] = useState<OverlayKey>(overrides.overlay ?? "none");
    const [query, setQuery] = useState(overrides.query ?? "");
    const search = useSearchEverywhereController({
      workspaceApi: stableWorkspaceApi,
      workspace: stableWorkspace,
      activePath: "/workspace/Entry.ets",
      editorSelectedText: "",
      quickOpenQuery: query,
      activeOverlay: overlay,
      indexVersionKey: "ready:1",
      setQuickOpenQuery: setQuery,
      setActiveOverlay: setOverlay,
      queryIndexCandidates: vi.fn(() => []),
      getTextSearchPaths: vi.fn(() => []),
      getRecentPaths: vi.fn(() => []),
      getOpenedPaths: overrides.getOpenedPaths ?? vi.fn(() => []),
      replaceQueryReadiness: vi.fn(),
      getOpenDocumentContent: vi.fn(() => null),
      getActiveContent: () => "struct Entry {}",
      hasDirtyDocuments: vi.fn(() => false),
      rememberCurrentLocation: vi.fn(),
      navigateToLocation: overrides.navigateToLocation ?? vi.fn(async () => undefined),
      explainIndexMiss: vi.fn(async () => null),
      recordRecentQueryExplain: vi.fn(),
      recordUiInteraction: overrides.recordUiInteraction ?? vi.fn(),
      onStatusChange: vi.fn(),
    });
    return { search, overlay, query };
  });
}

type HarnessOptions = {
  workspaceApi: WorkspaceApi;
  query: string;
  overlay: OverlayKey;
  navigateToLocation: (location: { path: string; line: number; column: number }, label: "Usage") => Promise<void>;
  recordUiInteraction: Parameters<typeof useSearchEverywhereController>[0]["recordUiInteraction"];
  getOpenedPaths: () => string[];
};

type CandidateEnvelope = {
  items: SearchCandidate[];
  readiness: WorkspaceIndexReadiness;
  explain: string[];
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(async () => ""),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    inspectEnvironment: vi.fn(),
    saveSettings: vi.fn(),
    loadSettings: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceApi;
}

function workspace(): WorkspaceViewModel {
  return {
    rootName: "workspace",
    rootPath: "/workspace",
    visibleFiles: ["/workspace/Entry.ets", "/workspace/EntryAbility.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 2,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}

function readiness(): WorkspaceIndexReadiness {
  return {
    rootPath: "/workspace",
    requestedGeneration: 1,
    servedGeneration: 1,
    state: "ready",
    retryable: false,
  };
}

function candidate(overrides: Partial<SearchCandidate>): SearchCandidate {
  return {
    id: "symbol:EntryAbility",
    source: "symbol",
    kind: "class",
    title: "EntryAbility",
    subtitle: "EntryAbility.ets",
    score: 1,
    freshness: "ready",
    ...overrides,
  };
}
