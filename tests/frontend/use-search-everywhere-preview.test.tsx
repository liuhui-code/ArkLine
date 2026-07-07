import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearchEverywhereController } from "@/components/layout/use-search-everywhere-controller";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexQueryScope, WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

describe("useSearchEverywhereController preview loading", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("debounces selected result preview file reads", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const openFile = vi.fn(async () => "struct Other {\n  width(100)\n}");
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [{
        path: "/workspace/Other.ets",
        relativePath: "Other.ets",
        fileName: "Other.ets",
        line: 2,
        column: 3,
        summary: "width(100)",
        preview: "  width(100)",
        previewStart: 2,
        previewEnd: 7,
        contextBefore: [],
        contextAfter: [],
      }],
    }));
    const { result } = renderHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ openFile, searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    await act(async () => Promise.resolve());

    expect(searchWorkspaceText).toHaveBeenCalledTimes(1);
    expect(openFile).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(199);
      await Promise.resolve();
    });
    expect(openFile).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(openFile).toHaveBeenCalledWith("/workspace/Other.ets");
    expect(result.current.search.searchEverywherePreviewContent).toContain("width");
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  const stableWorkspaceApi = overrides.workspaceApi ?? workspaceApi({});
  const stableWorkspace = overrides.workspace ?? workspace();
  return renderHook(() => {
    const [overlay, setOverlay] = useState<OverlayKey>(overrides.overlay ?? "none");
    const [query, setQuery] = useState(overrides.query ?? "");
    const search = useSearchEverywhereController({
      workspaceApi: stableWorkspaceApi,
      workspace: stableWorkspace,
      activePath: overrides.activePath ?? "/workspace/Entry.ets",
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
      navigateToLocation: vi.fn(async () => undefined),
      explainIndexMiss: vi.fn(async () => null),
      recordRecentQueryExplain: vi.fn(),
      recordUiInteraction: vi.fn(),
      onStatusChange: vi.fn(),
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
  query: string;
  overlay: OverlayKey;
};

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
    visibleFiles: ["/workspace/Entry.ets", "/workspace/Other.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 2,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}
