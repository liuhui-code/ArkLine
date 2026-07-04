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
    const queryWorkspaceFileSymbols = vi.fn(async () => indexedSymbols);
    const { result } = renderHook(() => useCurrentFileSymbolsController(options({
      rootPath: "/workspace",
      workspaceApi: workspaceApi({ queryWorkspaceFileSymbols }),
    })));

    act(() => result.current.showCurrentClassMethods());

    await waitFor(() => {
      expect(result.current.visibleCurrentClassMethods.map((method) => method.signature)).toEqual([
        "about(title: string)",
        "count: number",
      ]);
    });
    expect(queryWorkspaceFileSymbols).toHaveBeenCalledWith("/workspace", "/workspace/A.ets", "", 200);
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
    editorContent: content,
    editorLine: 3,
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
