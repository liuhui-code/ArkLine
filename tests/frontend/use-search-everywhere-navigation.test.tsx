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
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith("/workspace", "EntryFinal", "all", 25);
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
      editorContent: "struct Entry {}",
      editorSelectedText: "",
      quickOpenQuery: query,
      activeOverlay: overlay,
      indexVersionKey: "ready:1",
      setQuickOpenQuery: setQuery,
      setActiveOverlay: setOverlay,
      queryIndexCandidates: vi.fn(() => []),
      getTextSearchPaths: vi.fn(() => []),
      getRecentPaths: vi.fn(() => []),
      replaceQueryReadiness: vi.fn(),
      getOpenDocumentContent: vi.fn(() => null),
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
};

async function flushSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(90);
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
