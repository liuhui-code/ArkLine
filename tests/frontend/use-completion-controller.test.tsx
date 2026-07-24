import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCompletionController } from "@/components/layout/use-completion-controller";
import { LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD } from "@/components/layout/language-query-request-model";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { OverlayKey } from "@/components/layout/shell-state";

describe("useCompletionController", () => {
  afterEach(() => {
    vi.useRealTimers();
    languageQuerySnapshotStore.clear();
  });

  it("opens manual completion results in the completion overlay", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({
        completeSymbol: vi.fn(async () => [
          { label: "build()", detail: "Workspace method", kind: "function" },
        ]),
      }),
      onStatusChange,
    });

    await act(async () => {
      await result.current.completion.openCompletionFromEditor();
    });

    expect(result.current.overlay).toBe("completion");
    expect(result.current.completion.completionPopupVisible).toBe(true);
    expect(result.current.completion.completionPresentationResults.map((item) => item.label)).toEqual(["build()"]);
    expect(languageQuerySnapshotStore.snapshot()[0]).toMatchObject({
      kind: "completion",
      path: "/workspace/A.ets",
      contentClass: "normal",
    });
    expect(onStatusChange).toHaveBeenCalledWith("Completion: 1 items");
  });

  it("keeps hidden caret movement out of React state while retaining the latest anchor", async () => {
    const onRender = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({
        completeSymbol: vi.fn(async () => [
          { label: "build()", detail: "Workspace method", kind: "function" },
        ]),
      }),
      onRender,
    });
    const caret = {
      left: 80,
      right: 81,
      top: 40,
      bottom: 60,
      line: 4,
      column: 9,
      measured: true,
    };
    const renderCount = onRender.mock.calls.length;

    act(() => {
      result.current.completion.setCompletionAnchor(caret);
    });
    expect(result.current.completion.completionAnchorStore.getSnapshot()).toEqual(caret);
    expect(onRender).toHaveBeenCalledTimes(renderCount);

    await act(async () => {
      await result.current.completion.openCompletionFromEditor();
    });

    expect(result.current.completion.completionAnchorStore.getSnapshot()).toEqual(caret);
    expect(result.current.overlay).toBe("completion");
  });

  it("records envelope explain for empty completion results", async () => {
    const recordRecentQueryExplain = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      rootPath: "/workspace",
      workspaceApi: workspaceApi({
        semanticCompleteSymbol: vi.fn(async () => ({
          items: [],
          readiness: {
            rootPath: "/workspace",
            requestedGeneration: 4,
            servedGeneration: 3,
            state: "partial" as const,
            reason: "Completion waits for current file symbols",
            retryable: true,
          },
          explain: [
            "query:completion",
            "readiness:Partial",
            "reason:Completion waits for current file symbols",
          ],
        })),
      }),
      recordRecentQueryExplain,
      onStatusChange,
    });

    await act(async () => {
      await result.current.completion.openCompletionFromEditor();
    });

    expect(result.current.completion.completionStatus).toBe("empty");
    expect(result.current.completion.completionMessage).toBe("Completion waits for current file symbols");
    expect(recordRecentQueryExplain).toHaveBeenCalledWith(expect.objectContaining({
      kind: "completion",
      message: "Completion waits for current file symbols",
      explain: expect.arrayContaining(["reason:Completion waits for current file symbols"]),
    }));
    expect(onStatusChange).toHaveBeenCalledWith("Completion empty");
  });

  it("accepts a completion item and prepares editor insertion", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      editorContent: "Button().wid",
      editorSelection: { line: 1, column: 13 },
      workspaceApi: workspaceApi({
        completeSymbol: vi.fn(async () => [
          { label: "width", insertText: "width(${1:value})", detail: "ArkUI property", kind: "property" },
        ]),
      }),
      onStatusChange,
    });

    await act(async () => {
      await result.current.completion.openCompletionFromEditor();
    });
    const item = result.current.completion.completionPresentationResults[0];

    act(() => {
      result.current.completion.insertCompletionItem(item);
    });

    expect(result.current.overlay).toBe("none");
    expect(result.current.insertTarget).toMatchObject({ text: "width(value)", replaceBefore: 3 });
    expect(onStatusChange).toHaveBeenCalledWith("Inserted completion: width");
  });

  it("uses active document content for completion presentation context", async () => {
    const { result } = renderHarness({
      editorContent: "stale",
      activeContent: "Button().wid",
      editorSelection: { line: 1, column: 13 },
      workspaceApi: workspaceApi({
        completeSymbol: vi.fn(async () => [
          { label: "width", insertText: "width(${1:value})", detail: "ArkUI property", kind: "property" },
        ]),
      }),
    });

    await act(async () => {
      await result.current.completion.openCompletionFromEditor();
    });

    expect(result.current.completion.completionPresentationResults[0]?.label).toBe("width");
  });

  it("passes a stable language query snapshot to completion providers", async () => {
    const completeSymbol = vi.fn(async () => [
      { label: "width", detail: "ArkUI property", kind: "property" },
    ]);
    const { result } = renderHarness({
      activePath: "/workspace/Entry.ets",
      activeContent: "Button().wid",
      editorSelection: { line: 1, column: 13 },
      workspaceApi: workspaceApi({ completeSymbol }),
    });

    await act(async () => {
      await result.current.completion.openCompletionFromEditor();
    });

    expect(completeSymbol).toHaveBeenCalledWith({
      path: "/workspace/Entry.ets",
      line: 1,
      column: 13,
      content: "Button().wid",
    });
  });

  it("skips oversized completion requests before calling language providers", async () => {
    const completeSymbol = vi.fn(async () => [{ label: "width", detail: "ArkUI property", kind: "property" }]);
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      activeContent: "x".repeat(LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD),
      workspaceApi: workspaceApi({ completeSymbol }),
      onStatusChange,
    });

    await act(async () => {
      await result.current.completion.openCompletionFromEditor();
    });

    expect(completeSymbol).not.toHaveBeenCalled();
    expect(result.current.completion.completionStatus).toBe("empty");
    expect(result.current.completion.completionMessage).toContain("Completion skipped");
    expect(onStatusChange).toHaveBeenCalledWith(expect.stringContaining("Completion skipped"));
  });

  it("reports a timeout for a stalled completion request", async () => {
    vi.useFakeTimers();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({
        completeSymbol: vi.fn(() => new Promise<[]>(() => undefined)),
      }),
      onStatusChange,
    });

    await act(async () => {
      const request = result.current.completion.openCompletionFromEditor();
      vi.advanceTimersByTime(2500);
      await request;
    });

    expect(result.current.completion.completionStatus).toBe("error");
    expect(result.current.completion.completionMessage).toBe("Completion failed: Language request timed out after 2500ms");
    expect(onStatusChange).toHaveBeenCalledWith("Completion failed: Language request timed out after 2500ms");
  });

  it("does not let a stale completion timeout take focus from search", async () => {
    vi.useFakeTimers();
    const focusEditorSoon = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: workspaceApi({
        completeSymbol: vi.fn(() => new Promise<[]>(() => undefined)),
      }),
      focusEditorSoon,
      onStatusChange,
    });

    let completionRequest: Promise<void>;
    act(() => {
      completionRequest = result.current.completion.openCompletionFromEditor();
    });
    act(() => {
      result.current.openSearch("needle");
    });
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await completionRequest;
    });

    expect(result.current.overlay).toBe("searchEverywhere");
    expect(result.current.quickOpenQuery).toBe("needle");
    expect(focusEditorSoon).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalledWith(
      "Completion failed: Language request timed out after 2500ms",
    );
  });
});

function renderHarness(overrides: Partial<HarnessOptions> = {}) {
  return renderHook(() => {
    overrides.onRender?.();
    const [overlay, setOverlay] = useState<OverlayKey>("none");
    const [quickOpenQuery, setQuickOpenQuery] = useState("");
    const [insertTarget, setInsertTarget] = useState<{ text: string; replaceBefore?: number; nonce: number } | null>(null);
    const completion = useCompletionController({
      workspaceApi: overrides.workspaceApi ?? workspaceApi({ completeSymbol: vi.fn(async () => []) }),
      rootPath: overrides.rootPath,
      activePath: overrides.activePath ?? "/workspace/A.ets",
      editorSelection: overrides.editorSelection ?? { line: 1, column: 6 },
      quickOpenQuery,
      activeOverlay: overlay,
      settingsApplying: overrides.settingsApplying ?? false,
      getActiveContent: () => overrides.activeContent ?? overrides.editorContent ?? "build",
      setActiveOverlay: setOverlay,
      setQuickOpenQuery,
      setInsertTextTarget: setInsertTarget,
      bumpEditorFocusToken: overrides.bumpEditorFocusToken ?? vi.fn(),
      focusEditorSoon: overrides.focusEditorSoon ?? vi.fn(),
      isEditorFocused: overrides.isEditorFocused ?? vi.fn(() => true),
      recordRecentQueryExplain: overrides.recordRecentQueryExplain ?? vi.fn(),
      onStatusChange: overrides.onStatusChange ?? vi.fn(),
    });
    return {
      completion,
      overlay,
      quickOpenQuery,
      insertTarget,
      openSearch(query: string) {
        setQuickOpenQuery(query);
        setOverlay("searchEverywhere");
      },
    };
  });
}

type HarnessOptions = {
  workspaceApi: WorkspaceApi;
  rootPath: string;
  activePath: string | null;
  editorContent: string;
  activeContent: string;
  editorSelection: { line: number; column: number };
  settingsApplying: boolean;
  bumpEditorFocusToken: () => void;
  focusEditorSoon: () => void;
  isEditorFocused: () => boolean;
  recordRecentQueryExplain: Parameters<typeof useCompletionController>[0]["recordRecentQueryExplain"];
  onStatusChange: (message: string) => void;
  onRender: () => void;
};

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
