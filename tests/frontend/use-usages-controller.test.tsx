import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUsagesController } from "@/components/layout/use-usages-controller";
import type { UsageResult } from "@/features/workspace/usage-search";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";

describe("useUsagesController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("finds usages through the readiness-aware facade", async () => {
    const item = usage({ path: "/workspace/A.ets", line: 4, column: 2 });
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useUsagesController(options({
      workspaceApi: workspaceApi({
        queryUsagesWithReadiness: vi.fn(async () => ({
          items: [item],
          readiness: readiness("ready"),
        })),
      }),
      onStatusChange,
    })));

    await act(async () => {
      await result.current.findUsagesFromEditor();
    });

    expect(result.current.queryPanelVisible).toBe(true);
    expect(result.current.usageSearch.status).toBe("ready");
    expect(result.current.usageSearch.items).toEqual([item]);
    expect(onStatusChange).toHaveBeenCalledWith("Usages: 1 matches");
  });

  it("records envelope explain evidence for empty usage results", async () => {
    const recordRecentQueryExplain = vi.fn();
    const { result } = renderHook(() => useUsagesController(options({
      workspaceApi: workspaceApi({
        queryUsagesWithReadiness: vi.fn(async () => ({
          items: [],
          readiness: readiness("partial"),
          explain: [
            "query:usages",
            "readiness:Partial",
            "reason:References are still indexing",
          ],
        })),
      }),
      recordRecentQueryExplain,
    })));

    await act(async () => {
      await result.current.findUsagesFromEditor();
    });

    expect(result.current.usageSearch.status).toBe("empty");
    expect(result.current.usageSearch.message).toBe("References are still indexing");
    expect(recordRecentQueryExplain).toHaveBeenCalledWith(expect.objectContaining({
      kind: "usages",
      query: "A.ets:4:2",
      message: "References are still indexing",
    }));
  });

  it("reports unavailable usages when no active path exists", async () => {
    const { result } = renderHook(() => useUsagesController(options({ activePath: null })));

    await act(async () => {
      await result.current.findUsagesFromEditor();
    });

    expect(result.current.queryPanelVisible).toBe(true);
    expect(result.current.usageSearch.status).toBe("error");
    expect(result.current.usageSearch.message).toBe("Find Usages unavailable");
  });

  it("opens selected usage results through navigation", async () => {
    const rememberCurrentLocation = vi.fn();
    const navigateToUsage = vi.fn(async () => undefined);
    const { result } = renderHook(() => useUsagesController(options({
      rememberCurrentLocation,
      navigateToUsage,
    })));
    const item = usage({ path: "/workspace/A.ets", line: 4, column: 2 });

    await act(async () => {
      await result.current.openUsageResult(item);
    });

    expect(rememberCurrentLocation).toHaveBeenCalledTimes(1);
    expect(navigateToUsage).toHaveBeenCalledWith(item);
  });

  it("ignores stale usage results after a newer request starts", async () => {
    const first = createDeferred<ReturnType<typeof usage>[]>();
    const second = createDeferred<ReturnType<typeof usage>[]>();
    const queryUsagesWithReadiness = vi
      .fn()
      .mockReturnValueOnce(first.promise.then((items) => ({ items, readiness: readiness("ready") })))
      .mockReturnValueOnce(second.promise.then((items) => ({ items, readiness: readiness("ready") })));
    const { result } = renderHook(() => useUsagesController(options({
      workspaceApi: workspaceApi({ queryUsagesWithReadiness }),
    })));

    void act(() => {
      void result.current.findUsagesFromEditor();
      void result.current.findUsagesFromEditor();
    });
    await act(async () => {
      second.resolve([usage({ line: 9 })]);
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.usageSearch.items[0]?.line).toBe(9));

    await act(async () => {
      first.resolve([usage({ line: 4 })]);
      await Promise.resolve();
    });

    expect(result.current.usageSearch.items.map((item) => item.line)).toEqual([9]);
  });

  it("reports timeout for stalled usage queries", async () => {
    vi.useFakeTimers();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useUsagesController(options({
      workspaceApi: workspaceApi({
        queryUsagesWithReadiness: vi.fn(() => new Promise<never>(() => undefined)),
      }),
      onStatusChange,
    })));

    await act(async () => {
      const request = result.current.findUsagesFromEditor();
      vi.advanceTimersByTime(3500);
      await request;
    });

    expect(result.current.usageSearch.status).toBe("error");
    expect(result.current.usageSearch.message).toBe("Language request timed out after 3500ms");
    expect(onStatusChange).toHaveBeenCalledWith("Find Usages failed: Language request timed out after 3500ms");
  });
});

function options(overrides: Partial<Parameters<typeof useUsagesController>[0]> = {}) {
  return {
    workspaceApi: workspaceApi({
      findUsages: vi.fn(async () => []),
    }),
    workspace: workspace(),
    activePath: "/workspace/A.ets",
    editorSelection: { line: 4, column: 2 },
    getActiveContent: () => "class A {}",
    settingsApplying: false,
    rememberCurrentLocation: vi.fn(),
    navigateToUsage: vi.fn(async () => undefined),
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
    visibleFiles: [],
    fileTree: [],
    scanSummary: {
      scannedFiles: 0,
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
    servedGeneration: 1,
    state,
    retryable: state !== "ready",
  };
}

function usage(input: Partial<UsageResult>): UsageResult {
  return {
    path: "/workspace/A.ets",
    line: 1,
    column: 1,
    preview: "class A",
    kind: "usage",
    confidence: "exact",
    ...input,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
