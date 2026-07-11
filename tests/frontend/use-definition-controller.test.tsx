import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDefinitionController } from "@/components/layout/use-definition-controller";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { idleUsageSearchState, type UsageSearchState } from "@/features/workspace/usage-search";

describe("useDefinitionController", () => {
  afterEach(() => {
    languageQuerySnapshotStore.clear();
  });

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
    expect(languageQuerySnapshotStore.snapshot()[0]).toMatchObject({
      kind: "definition",
      path: "/workspace/A.ets",
      contentClass: "normal",
    });
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

  it("schedules foreground navigation indexing before querying definition candidates", async () => {
    const events: string[] = [];
    const scheduleForegroundNavigationIndex = vi.fn(async () => {
      events.push("schedule-navigation-index");
    });
    const queryDefinitionCandidatesWithReadiness = vi.fn(async () => {
      events.push("query-definition");
      return {
        items: [{ path: "/workspace/B.ets", line: 8, column: 2, preview: "class B" }],
        readiness: readiness("ready"),
      };
    });
    const { result } = renderHook(() => useDefinitionController(options({
      workspaceApi: workspaceApi({
        scheduleForegroundNavigationIndex,
        queryDefinitionCandidatesWithReadiness,
      }),
    })));

    await act(async () => {
      await result.current.goToDefinitionFromEditor();
    });

    expect(scheduleForegroundNavigationIndex).toHaveBeenCalledWith("/workspace", ["/workspace/A.ets"]);
    expect(events.slice(0, 2)).toEqual(["schedule-navigation-index", "query-definition"]);
  });

  it("keeps the latest resolved definition target when an older file open finishes later", async () => {
    const firstOpen = createDeferred<void>();
    const secondOpen = createDeferred<void>();
    const openFile = vi.fn((path: string) => path.endsWith("B.ets") ? firstOpen.promise : secondOpen.promise);
    const setSelectionTarget = vi.fn();
    const queryDefinitionCandidatesWithReadiness = vi.fn(async (_rootPath: string, request: { line: number }) => ({
      items: request.line === 4
        ? [{ path: "/workspace/B.ets", line: 8, column: 2, preview: "class B" }]
        : [{ path: "/workspace/C.ets", line: 12, column: 4, preview: "class C" }],
      readiness: readiness("ready"),
    }));
    const { result } = renderHook(() => useDefinitionController(options({
      workspaceApi: workspaceApi({ queryDefinitionCandidatesWithReadiness }),
      openFile,
      setSelectionTarget,
    })));

    void act(() => {
      void result.current.goToDefinitionFromEditor({ line: 4, column: 2 });
      void result.current.goToDefinitionFromEditor({ line: 5, column: 2 });
    });
    await act(async () => {
      secondOpen.resolve();
      await Promise.resolve();
    });

    expect(setSelectionTarget).toHaveBeenLastCalledWith(expect.objectContaining({ line: 12, column: 4 }));

    await act(async () => {
      firstOpen.resolve();
      await Promise.resolve();
    });

    expect(setSelectionTarget).toHaveBeenCalledTimes(1);
  });

  it("uses one active content snapshot for same-file fallback definition", async () => {
    const getActiveContent = vi.fn(() => [
      "class A {",
      "  run() {}",
      "  build() {",
      "    this.run();",
      "  }",
      "}",
    ].join("\n"));
    const setSelectionTarget = vi.fn();
    const { result } = renderHook(() => useDefinitionController(options({
      workspaceApi: workspaceApi({
        gotoDefinition: vi.fn(async () => null),
      }),
      workspace: {
        ...workspace(),
        visibleFiles: ["/workspace/A.ets"],
      },
      editorSelection: { line: 4, column: 11 },
      getActiveContent,
      setSelectionTarget,
    })));

    await act(async () => {
      await result.current.goToDefinitionFromEditor();
    });

    expect(getActiveContent).toHaveBeenCalledTimes(1);
    expect(setSelectionTarget).toHaveBeenCalledWith(expect.objectContaining({ line: 2, column: 3 }));
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
