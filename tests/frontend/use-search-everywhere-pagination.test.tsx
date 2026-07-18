import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useSearchEverywhereController } from "@/components/layout/use-search-everywhere-controller";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";

describe("useSearchEverywhereController pagination", () => {
  it("loads the next fallback text search page from the stored cursor", async () => {
    vi.useFakeTimers();
    const files = {
      "/workspace/a.ets": Array.from({ length: 51 }, (_, index) => `width(${index + 1})`).join("\n"),
      "/workspace/b.ets": "width(52)",
    };
    const { result } = renderHarness({
      query: "width",
      getTextSearchPaths: () => Object.keys(files),
      getOpenDocumentContent: (path) => files[path as keyof typeof files] ?? null,
      hasDirtyDocuments: () => true,
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    expect(result.current.search.searchEverywhereResult.matches).toHaveLength(50);
    expect(result.current.search.searchEverywhereCanLoadMore).toBe(true);

    await act(async () => {
      await result.current.search.loadNextSearchEverywherePage?.();
    });
    expect(result.current.search.searchEverywhereResult.matches.map((match) => `${match.relativePath}:${match.line}`).slice(-2))
      .toEqual(["a.ets:51", "b.ets:1"]);
    expect(result.current.search.searchEverywhereResult.matches).toHaveLength(52);
    expect(result.current.search.searchEverywhereCanLoadMore).toBe(false);
  });

  it("loads the next page when keyboard selection moves past the last text result", async () => {
    vi.useFakeTimers();
    const files = {
      "/workspace/a.ets": Array.from({ length: 51 }, (_, index) => `width(${index + 1})`).join("\n"),
      "/workspace/b.ets": "width(52)",
    };
    const { result } = renderHarness({
      query: "width",
      getTextSearchPaths: () => Object.keys(files),
      getOpenDocumentContent: (path) => files[path as keyof typeof files] ?? null,
      hasDirtyDocuments: () => true,
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    act(() => result.current.search.setSearchEverywhereSelectedIndex(49));

    await act(async () => {
      result.current.search.moveSearchEverywhereSelection(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.search.searchEverywhereResult.matches).toHaveLength(52);
    expect(result.current.search.searchEverywhereSelectedIndex).toBe(50);
  });

  it("passes the stored cursor to native text search when loading more", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const searchWorkspaceText = vi
      .fn()
      .mockResolvedValueOnce({
        query: { kind: "text" as const, query: "width" },
        matches: [match("a.ets", 1)],
        nextCursor: { pathIndex: 0, lineIndex: 1 },
        limitReached: true,
        partial: true,
      })
      .mockResolvedValueOnce({
        query: { kind: "text" as const, query: "width" },
        matches: [match("a.ets", 2)],
        nextCursor: null,
        limitReached: false,
        partial: false,
      });
    const { result } = renderHarness({
      query: "width",
      workspaceApi: workspaceApi({ searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    await act(async () => {
      await result.current.search.loadNextSearchEverywherePage?.();
    });

    expect(searchWorkspaceText).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: { pathIndex: 0, lineIndex: 1 },
    }));
    expect(result.current.search.searchEverywhereResult.matches.map((item) => item.line)).toEqual([1, 2]);
  });

  it("loads the next search everywhere candidate page from keyboard navigation", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 50 }, (_, index) => candidate(`Alpha${index}.ets`)),
        readiness: readiness(),
        nextCursor: 50,
      })
      .mockResolvedValueOnce({
        items: [candidate("Alpha50.ets")],
        readiness: readiness(),
        nextCursor: null,
      });
    const { result } = renderHarness({
      query: "Alpha",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    expect(result.current.search.searchEverywhereCandidates).toHaveLength(24);
    act(() => result.current.search.setSearchEverywhereSelectedIndex(49));
    await act(async () => {
      result.current.search.moveSearchEverywhereSelection(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "/workspace",
      "Alpha",
      "all",
      24,
      24,
      { activePath: "/workspace/a.ets", recentPaths: [], openedPaths: [] },
      expect.any(Number),
      250,
    );
    expect(result.current.search.searchEverywhereCandidates).toHaveLength(25);
    expect(result.current.search.searchEverywhereSelectedIndex).toBe(24);
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  return renderHook(() => {
    const [overlay, setOverlay] = useState<OverlayKey>("searchEverywhere");
    const [query, setQuery] = useState(overrides.query ?? "");
    const search = useSearchEverywhereController({
      workspaceApi: overrides.workspaceApi ?? workspaceApi({}),
      workspace: workspace(),
      activePath: "/workspace/a.ets",
      getEditorSelectedText: () => "",
      quickOpenQuery: query,
      activeOverlay: overlay,
      indexVersionKey: "ready:1",
      setQuickOpenQuery: setQuery,
      setActiveOverlay: setOverlay,
      queryIndexCandidates: () => [],
      getTextSearchPaths: overrides.getTextSearchPaths ?? (() => []),
      getRecentPaths: () => [],
      getOpenedPaths: () => [],
      replaceQueryReadiness: vi.fn(),
      getOpenDocumentContent: overrides.getOpenDocumentContent ?? (() => null),
      getActiveContent: () => "",
      hasDirtyDocuments: overrides.hasDirtyDocuments ?? (() => false),
      rememberCurrentLocation: vi.fn(),
      navigateToLocation: vi.fn(async () => undefined),
      explainIndexMiss: vi.fn(async () => null),
      recordRecentQueryExplain: vi.fn(),
      onStatusChange: vi.fn(),
    });
    return { search };
  });
}

async function flushSearchDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

type HarnessOptions = {
  query: string;
  getTextSearchPaths: () => string[];
  getOpenDocumentContent: (path: string) => string | null;
  hasDirtyDocuments: () => boolean;
  workspaceApi: WorkspaceApi;
};

function match(fileName: string, line: number) {
  return {
    path: `/workspace/${fileName}`,
    relativePath: fileName,
    fileName,
    line,
    column: 1,
    summary: "width",
    preview: "width",
    previewStart: 0,
    previewEnd: 5,
    contextBefore: [],
    contextAfter: [],
  };
}

function candidate(fileName: string) {
  return {
    id: fileName,
    title: fileName,
    subtitle: fileName,
    path: `/workspace/${fileName}`,
    source: "file",
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
    visibleFiles: ["/workspace/a.ets", "/workspace/b.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 2,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}
