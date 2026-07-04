import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDefinitionController } from "@/components/layout/use-definition-controller";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { idleUsageSearchState, type UsageSearchState } from "@/features/workspace/usage-search";

describe("useDefinitionController", () => {
  it("opens indexed resolved definition targets", async () => {
    const openFile = vi.fn(async () => undefined);
    const setSelectionTarget = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useDefinitionController(options({
      workspaceApi: workspaceApi({
        queryDefinitionCandidatesWithReadiness: vi.fn(async () => ({
          items: [{ path: "/workspace/B.ets", line: 8, column: 2, preview: "class B" }],
          readiness: readiness("ready"),
        })),
      }),
      openFile,
      setSelectionTarget,
      onStatusChange,
    })));

    await act(async () => {
      await result.current.goToDefinitionFromEditor();
    });

    expect(openFile).toHaveBeenCalledWith("/workspace/B.ets");
    expect(setSelectionTarget).toHaveBeenCalledWith(expect.objectContaining({ line: 8, column: 2 }));
    expect(onStatusChange).toHaveBeenCalledWith("Definition: B.ets:8:2");
  });

  it("shows indexed definition candidates in the shared query panel", async () => {
    let usageSearch: UsageSearchState = idleUsageSearchState();
    const openEditorQueryPanel = vi.fn();
    const { result } = renderHook(() => useDefinitionController(options({
      workspaceApi: workspaceApi({
        queryDefinitionCandidatesWithReadiness: vi.fn(async () => ({
          items: [
            { path: "/workspace/A.ets", line: 4, column: 2, preview: "class A" },
            { path: "/workspace/B.ets", line: 8, column: 2, preview: "class B" },
          ],
          readiness: readiness("ready"),
        })),
      }),
      openEditorQueryPanel,
      setUsageSearch: (next) => {
        usageSearch = typeof next === "function" ? next(usageSearch) : next;
      },
    })));

    await act(async () => {
      await result.current.goToDefinitionFromEditor();
    });

    expect(openEditorQueryPanel).toHaveBeenCalledTimes(1);
    expect(usageSearch.status).toBe("ready");
    expect(usageSearch.items).toHaveLength(2);
  });

  it("uses envelope explain for definition misses", async () => {
    const recordRecentQueryExplain = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useDefinitionController(options({
      workspaceApi: workspaceApi({
        queryDefinitionCandidatesWithReadiness: vi.fn(async () => ({
          items: [],
          readiness: readiness("partial"),
          explain: [
            "query:definition",
            "readiness:Partial",
            "reason:Current file symbols are still indexing",
          ],
        })),
      }),
      recordRecentQueryExplain,
      onStatusChange,
    })));

    await act(async () => {
      await result.current.goToDefinitionFromEditor();
    });

    expect(onStatusChange).toHaveBeenCalledWith("Go to Definition miss: Current file symbols are still indexing");
    expect(recordRecentQueryExplain).toHaveBeenCalledWith(expect.objectContaining({
      kind: "definition",
      query: "A.ets:4:2",
    }));
  });
});

function options(overrides: Partial<Parameters<typeof useDefinitionController>[0]> = {}) {
  return {
    workspaceApi: workspaceApi({
      gotoDefinition: vi.fn(async () => null),
    }),
    workspace: workspace(),
    activePath: "/workspace/A.ets",
    editorSelection: { line: 4, column: 2 },
    getActiveContent: () => "class A {}",
    settingsApplying: false,
    openEditorQueryPanel: vi.fn(),
    setUsageSearch: vi.fn(),
    rememberCurrentLocation: vi.fn(),
    openFile: vi.fn(async () => undefined),
    setSelectionTarget: vi.fn(),
    bumpEditorFocusToken: vi.fn(),
    focusEditorSoon: vi.fn(),
    explainIndexMiss: vi.fn(async () => null),
    recordRecentQueryExplain: vi.fn(),
    onStatusChange: vi.fn(),
    ...overrides,
  };
}

function workspaceApi(overrides: Partial<WorkspaceApi>): WorkspaceApi {
  return {
    openDemoWorkspace: vi.fn(),
    openWorkspace: vi.fn(),
    openFile: vi.fn(),
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
    visibleFiles: ["/workspace/A.ets"],
    fileTree: [],
    scanSummary: {
      scannedFiles: 1,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}

function readiness(state: "ready" | "partial") {
  return {
    rootPath: "/workspace",
    requestedGeneration: 1,
    servedGeneration: state === "ready" ? 1 : null,
    state,
    retryable: state !== "ready",
  };
}
