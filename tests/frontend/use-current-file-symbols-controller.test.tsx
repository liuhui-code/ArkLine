import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCurrentFileSymbolsController } from "@/components/layout/use-current-file-symbols-controller";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

const content = [
  "class Entry {",
  "  private count: number;",
  "  build() {",
  "  }",
  "  about(title: string) {",
  "  }",
  "}",
].join("\n");
const getDefaultEditorLine = () => 3;

describe("useCurrentFileSymbolsController", () => {
  it("reports unavailable when no file is active", () => {
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({
      activePath: null,
      onStatusChange,
    })));

    act(() => result.current.showCurrentClassMethods());

    expect(onStatusChange).toHaveBeenCalledWith("Current class methods unavailable: no active file");
    expect(result.current.currentMethodsVisible).toBe(false);
  });

  it("shows and filters local current class methods", () => {
    const { result } = renderHook(() => useCurrentFileSymbolsController(options()));

    act(() => result.current.showCurrentClassMethods());
    act(() => result.current.setCurrentMethodsQuery("abo"));

    expect(result.current.currentMethodsVisible).toBe(true);
    expect(result.current.visibleCurrentClassMethods.map((method) => method.signature)).toEqual(["about(title: string)"]);
  });

  it("does not read active document content before the file structure popup opens", () => {
    const getActiveContent = vi.fn(() => content);
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({ getActiveContent })));

    expect(getActiveContent).not.toHaveBeenCalled();

    act(() => result.current.showCurrentClassMethods());

    expect(getActiveContent).toHaveBeenCalledTimes(1);
  });

  it("uses active document content instead of stale shell content", () => {
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({
      getActiveContent: () => content,
    })));

    act(() => result.current.showCurrentClassMethods());

    expect(result.current.visibleCurrentClassMethods.map((method) => method.name)).toContain("about");
  });

  it("loads indexed methods and keeps local signatures for matching names", async () => {
    const indexedSymbols: SearchCandidate[] = [
      {
        id: "symbol:about",
        source: "symbol",
        kind: "method",
        title: "about",
        subtitle: "A.ets",
        signature: "about(indexed)",
        path: "/workspace/A.ets",
        line: 5,
        column: 3,
        score: 1,
        freshness: "ready",
      },
      {
        id: "symbol:count",
        source: "symbol",
        kind: "field",
        title: "count",
        subtitle: "A.ets",
        signature: "count: number",
        path: "/workspace/A.ets",
        line: 2,
        column: 11,
        score: 1,
        freshness: "ready",
      },
    ];
    const queryWorkspaceFileSymbolsWithReadiness = vi.fn(async () => ({
      items: indexedSymbols,
      readiness: readiness(),
      nextCursor: null,
    }));
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({
      rootPath: "/workspace",
      workspaceApi: workspaceApi({ queryWorkspaceFileSymbolsWithReadiness }),
    })));

    act(() => result.current.showCurrentClassMethods());

    await waitFor(() => {
      expect(result.current.visibleCurrentClassMethods.map((method) => method.signature)).toEqual([
        "about(title: string)",
        "count: number",
      ]);
    });
    expect(queryWorkspaceFileSymbolsWithReadiness).toHaveBeenCalledWith("/workspace", "/workspace/A.ets", "", 80, null);
  });

  it("loads the next indexed symbol page when selection reaches the end", async () => {
    const queryWorkspaceFileSymbolsWithReadiness = vi
      .fn()
      .mockResolvedValueOnce({
        items: Array.from({ length: 80 }, (_, index) => symbolCandidate(`method${index}`, index + 1)),
        readiness: readiness(),
        nextCursor: 80,
      })
      .mockResolvedValueOnce({
        items: [symbolCandidate("method80", 81)],
        readiness: readiness(),
        nextCursor: null,
      });
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({
      rootPath: "/workspace",
      getActiveContent: () => "",
      workspaceApi: workspaceApi({ queryWorkspaceFileSymbolsWithReadiness }),
    })));

    act(() => result.current.showCurrentClassMethods());
    await waitFor(() => expect(result.current.visibleCurrentClassMethods).toHaveLength(80));
    act(() => result.current.setCurrentMethodsSelectedIndex(79));

    await waitFor(() => expect(queryWorkspaceFileSymbolsWithReadiness).toHaveBeenLastCalledWith(
      "/workspace",
      "/workspace/A.ets",
      "",
      80,
      80,
    ));
    await waitFor(() => expect(result.current.visibleCurrentClassMethods).toHaveLength(81));
  });

  it("ignores stale indexed symbol responses after reopening the palette", async () => {
    const first = createDeferred<ReturnType<typeof symbolEnvelope>>();
    const second = createDeferred<ReturnType<typeof symbolEnvelope>>();
    const queryWorkspaceFileSymbolsWithReadiness = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({
      rootPath: "/workspace",
      getActiveContent: () => "",
      workspaceApi: workspaceApi({ queryWorkspaceFileSymbolsWithReadiness }),
    })));

    act(() => result.current.showCurrentClassMethods());
    act(() => result.current.closeCurrentClassMethods());
    act(() => result.current.showCurrentClassMethods());
    await act(async () => {
      second.resolve(symbolEnvelope("freshMethod", 8));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.visibleCurrentClassMethods.map((method) => method.name)).toEqual(["freshMethod"]));

    await act(async () => {
      first.resolve(symbolEnvelope("staleMethod", 4));
      await Promise.resolve();
    });

    expect(result.current.visibleCurrentClassMethods.map((method) => method.name)).toEqual(["freshMethod"]);
  });

  it("opens a selected method at its source location", () => {
    const rememberCurrentLocation = vi.fn();
    const setSelectionTarget = vi.fn();
    const bumpEditorFocusToken = vi.fn();
    const focusEditorSoon = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({
      rememberCurrentLocation,
      setSelectionTarget,
      bumpEditorFocusToken,
      focusEditorSoon,
      onStatusChange,
    })));

    act(() => result.current.showCurrentClassMethods());
    act(() => result.current.openCurrentClassMethod(result.current.visibleCurrentClassMethods[0]));

    expect(rememberCurrentLocation).toHaveBeenCalledTimes(1);
    expect(setSelectionTarget).toHaveBeenCalledWith(expect.objectContaining({ line: 2, column: 11 }));
    expect(bumpEditorFocusToken).toHaveBeenCalledTimes(1);
    expect(focusEditorSoon).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Member: count: number");
    expect(result.current.currentMethodsVisible).toBe(false);
  });
});

function options(overrides: Partial<Parameters<typeof useCurrentFileSymbolsController>[0]> = {}) {
  return {
    workspaceApi: workspaceApi({}),
    rootPath: null,
    activePath: "/workspace/A.ets",
    getEditorLine: getDefaultEditorLine,
    getActiveContent: () => content,
    onBeforeShow: vi.fn(),
    rememberCurrentLocation: vi.fn(),
    setSelectionTarget: vi.fn(),
    bumpEditorFocusToken: vi.fn(),
    focusEditorSoon: vi.fn(),
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

function symbolCandidate(name: string, line: number): SearchCandidate {
  return {
    id: `symbol:${name}`,
    source: "symbol",
    kind: "method",
    title: name,
    subtitle: "A.ets",
    signature: `${name}()`,
    path: "/workspace/A.ets",
    line,
    column: 3,
    score: 1,
    freshness: "ready",
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

function symbolEnvelope(name: string, line: number) {
  return {
    items: [symbolCandidate(name, line)],
    readiness: readiness(),
    nextCursor: null,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
