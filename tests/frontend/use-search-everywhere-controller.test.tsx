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

    expect(result.current.search.searchEverywhereResult.matches).toHaveLength(1);
    expect(result.current.search.searchEverywherePreviewContent).toBe("struct Entry {\n  width(100)\n}");
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
      onStatusChange,
    });
    return { search, overlay, query };
  });
}

async function flushSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(90);
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
