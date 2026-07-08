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
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  return renderHook(() => {
    const [overlay, setOverlay] = useState<OverlayKey>("searchEverywhere");
    const [query, setQuery] = useState(overrides.query ?? "");
    const search = useSearchEverywhereController({
      workspaceApi: workspaceApi({}),
      workspace: workspace(),
      activePath: "/workspace/a.ets",
      editorSelectedText: "",
      quickOpenQuery: query,
      activeOverlay: overlay,
      indexVersionKey: "ready:1",
      setQuickOpenQuery: setQuery,
      setActiveOverlay: setOverlay,
      queryIndexCandidates: () => [],
      getTextSearchPaths: overrides.getTextSearchPaths ?? (() => []),
      getRecentPaths: () => [],
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
