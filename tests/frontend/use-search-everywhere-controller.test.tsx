import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearchEverywhereController } from "@/components/layout/use-search-everywhere-controller";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexQueryScope, WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";

describe("useSearchEverywhereController", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("prefills Find in Files from selected editor text", async () => {
    const { result } = renderHarness({ editorSelectedText: "  selected   text  " });

    await act(async () => {
      result.current.search.openSearchOverlay("find");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.overlay).toBe("searchEverywhere");
    expect(result.current.query).toBe("selected text");
    expect(result.current.search.searchEverywhereMode).toBe("find");
  });

  it("loads Search Everywhere candidates and opens the selected item", async () => {
    vi.useFakeTimers();
    const navigateToLocation = vi.fn(async () => undefined);
    const rememberCurrentLocation = vi.fn();
    const candidates = [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets", line: 8, column: 3 })];
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: candidates,
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
      navigateToLocation,
      rememberCurrentLocation,
    });

    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith("/workspace", "Entry", "all", 25);
    expect(result.current.search.searchEverywhereCandidates).toHaveLength(1);

    await act(async () => {
      await result.current.search.openSelectedSearchEverywhereResult();
    });

    expect(rememberCurrentLocation).toHaveBeenCalledTimes(1);
    expect(navigateToLocation).toHaveBeenCalledWith(
      { path: "/workspace/EntryAbility.ets", line: 8, column: 3 },
      "Usage",
    );
    expect(result.current.overlay).toBe("none");
  });

  it("does not rerun stale backend search while typing before debounce settles", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    act(() => result.current.search.handleOverlayQueryChange("EntryA"));

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(2);
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith("/workspace", "EntryA", "all", 25);
  });

  it("does not query the backend for a single-character search", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "E",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();
    expect(result.current.search.searchEverywhereCandidates).toEqual([]);
  });

  it("invalidates a slow backend search immediately when the query changes", async () => {
    vi.useFakeTimers();
    const slowSearch = createDeferred<{
      items: SearchCandidate[];
      readiness: WorkspaceIndexReadiness;
      explain: string[];
    }>();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(() => slowSearch.promise);
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    act(() => result.current.search.handleOverlayQueryChange("EntryA"));
    await act(async () => {
      slowSearch.resolve({
        items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
        readiness: readiness(),
        explain: [],
      });
      await Promise.resolve();
    });

    expect(result.current.search.searchEverywhereCandidates).toEqual([]);
  });

  it("keeps query changes local instead of cancelling backend work per keystroke", () => {
    vi.useFakeTimers();
    const cancelWorkspaceSearch = vi.fn(async () => undefined);
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ cancelWorkspaceSearch }),
    });

    act(() => result.current.search.handleOverlayQueryChange("EntryA"));

    expect(cancelWorkspaceSearch).not.toHaveBeenCalled();
  });

  it("notifies the backend to cancel text search when the overlay resets", () => {
    vi.useFakeTimers();
    const cancelWorkspaceSearch = vi.fn(async () => undefined);
    const { result } = renderHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ cancelWorkspaceSearch }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    act(() => result.current.search.resetSearchOverlayState());

    expect(cancelWorkspaceSearch).toHaveBeenLastCalledWith(
      "/workspace",
      "text",
      expect.any(Number),
    );
  });

  it("coalesces rapid typing and deleting into only the latest debounced query", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets" })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderHarness({
      query: "",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    act(() => {
      for (const query of rapidSearchQueries("EntryAbility")) {
        result.current.search.handleOverlayQueryChange(query);
      }
    });

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();

    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "/workspace",
      "EntryAbility",
      "all",
      25,
    );
  });

  it("does not let a slow stale search repopulate results after the query is deleted", async () => {
    vi.useFakeTimers();
    const slowSearch = createDeferred<{
      items: SearchCandidate[];
      readiness: WorkspaceIndexReadiness;
      explain: string[];
    }>();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(() => slowSearch.promise);
    const { result } = renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    act(() => result.current.search.handleOverlayQueryChange(""));
    await flushSearchDebounce();
    expect(result.current.search.searchEverywhereCandidates).toEqual([]);

    await act(async () => {
      slowSearch.resolve({
        items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
        readiness: readiness(),
        explain: [],
      });
      await Promise.resolve();
    });

    expect(result.current.search.searchEverywhereCandidates).toEqual([]);
  });

  it("records search interaction latency when backend candidates resolve", async () => {
    vi.useFakeTimers();
    const recordUiInteraction = vi.fn();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
      readiness: readiness(),
      explain: [],
    }));

    renderHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      recordUiInteraction,
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();

    expect(recordUiInteraction).toHaveBeenCalledWith("searchEverywhere", "Entry", expect.any(Number), expect.any(Number));
  });

  it("runs text search and loads selected file preview content", async () => {
    vi.useFakeTimers();
    const { result } = renderHarness({
      query: "width",
      overlay: "searchEverywhere",
      editorContent: "struct Entry {\n  width(100)\n}",
      workspaceApi: workspaceApi({
        openFile: vi.fn(async () => "struct Entry {\n  width(100)\n}"),
      }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    await flushPreviewDebounce();

    expect(result.current.search.searchEverywhereResult.matches).toHaveLength(1);
    expect(result.current.search.searchEverywherePreviewContent).toBe("struct Entry {\n  width(100)\n}");
  });

  it("passes a text search generation to backend workspace search", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
    }));
    const { result } = renderHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();

    expect(searchWorkspaceText).toHaveBeenCalledWith(expect.objectContaining({
      generation: expect.any(Number),
      query: "width",
    }));
  });

  it("shows partial text search status from backend results", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
      partial: true,
      searchedFiles: 12,
      limitReached: true,
    }));
    const { result } = renderHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();

    expect(result.current.search.searchEverywhereTruncationNotice).toContain("scanning 12 file");
  });

  it("does not call native text search after the Find query is deleted", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
    }));
    const { result } = renderHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    const callsBeforeDelete = searchWorkspaceText.mock.calls.length;
    expect(callsBeforeDelete).toBeGreaterThan(0);

    act(() => result.current.search.handleOverlayQueryChange(""));
    await flushSearchDebounce();

    expect(searchWorkspaceText).toHaveBeenCalledTimes(callsBeforeDelete);
    expect(result.current.search.searchEverywhereResult.matches).toEqual([]);
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  const stableWorkspaceApi = overrides.workspaceApi ?? workspaceApi({});
  const stableWorkspace = overrides.workspace ?? workspace();
  const queryIndexCandidates = overrides.queryIndexCandidates ?? vi.fn(() => []);
  const getTextSearchPaths = overrides.getTextSearchPaths ?? vi.fn(() => ["/workspace/Entry.ets"]);
  const getRecentPaths = overrides.getRecentPaths ?? vi.fn(() => []);
  const replaceQueryReadiness = overrides.replaceQueryReadiness ?? vi.fn();
  const getOpenDocumentContent = overrides.getOpenDocumentContent ?? vi.fn(() => null);
  const hasDirtyDocuments = overrides.hasDirtyDocuments ?? vi.fn(() => false);
  const rememberCurrentLocation = overrides.rememberCurrentLocation ?? vi.fn();
  const navigateToLocation = overrides.navigateToLocation ?? vi.fn(async () => undefined);
  const explainIndexMiss = overrides.explainIndexMiss ?? vi.fn(async () => null);
  const recordRecentQueryExplain = overrides.recordRecentQueryExplain ?? vi.fn();
  const recordUiInteraction = overrides.recordUiInteraction ?? vi.fn();
  const onStatusChange = overrides.onStatusChange ?? vi.fn();
  return renderHook(() => {
    const [overlay, setOverlay] = useState<OverlayKey>(overrides.overlay ?? "none");
    const [query, setQuery] = useState(overrides.query ?? "");
    const search = useSearchEverywhereController({
      workspaceApi: stableWorkspaceApi,
      workspace: stableWorkspace,
      activePath: overrides.activePath ?? "/workspace/Entry.ets",
      editorContent: overrides.editorContent ?? "struct Entry {}",
      editorSelectedText: overrides.editorSelectedText ?? "",
      quickOpenQuery: query,
      activeOverlay: overlay,
      indexVersionKey: "ready:1",
      setQuickOpenQuery: setQuery,
      setActiveOverlay: setOverlay,
      queryIndexCandidates,
      getTextSearchPaths,
      getRecentPaths,
      replaceQueryReadiness,
      getOpenDocumentContent,
      hasDirtyDocuments,
      rememberCurrentLocation,
      navigateToLocation,
      explainIndexMiss,
      recordRecentQueryExplain,
      recordUiInteraction,
      onStatusChange,
    });
    return { search, overlay, query };
  });
}

async function flushSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushPreviewDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();
  });
}

type HarnessOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  editorContent: string;
  editorSelectedText: string;
  query: string;
  overlay: OverlayKey;
  queryIndexCandidates: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
  getTextSearchPaths: () => string[];
  getRecentPaths: () => string[];
  replaceQueryReadiness: (readiness: WorkspaceIndexReadiness) => void;
  getOpenDocumentContent: (path: string) => string | null;
  hasDirtyDocuments: () => boolean;
  rememberCurrentLocation: () => void;
  navigateToLocation: (location: { path: string; line: number; column: number }, label: "Usage") => Promise<void>;
  explainIndexMiss: (kind: "search", query: string) => Promise<string | null>;
  recordRecentQueryExplain: Parameters<typeof useSearchEverywhereController>[0]["recordRecentQueryExplain"];
  recordUiInteraction: Parameters<typeof useSearchEverywhereController>[0]["recordUiInteraction"];
  onStatusChange: (message: string) => void;
};

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(async () => ""),
    saveFile: vi.fn(),
    runValidation: vi.fn(),
    loadDiff: vi.fn(),
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
    visibleFiles: ["/workspace/Entry.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 1,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
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

function rapidSearchQueries(finalQuery: string) {
  const growing = Array.from({ length: finalQuery.length }, (_, index) => finalQuery.slice(0, index + 1));
  const shrinking = Array.from({ length: finalQuery.length }, (_, index) => finalQuery.slice(0, finalQuery.length - index - 1));
  return [...growing, ...shrinking, ...growing];
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
