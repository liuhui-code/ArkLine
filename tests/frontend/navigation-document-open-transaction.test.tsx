import { Text } from "@codemirror/state";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorSurfaceController } from "@/components/layout/use-editor-surface-controller";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("navigation document open transaction", () => {
  it("lets an already loaded document supersede a pending cross-file open", async () => {
    const pending = createDeferred<string>();
    const documents = new Map<string, { currentContent: string }>([
      ["/workspace/C.ets", { currentContent: "cached C" }],
    ]);
    const openFile = vi.fn(() => pending.promise);
    const setActiveDocument = vi.fn();
    const openDocument = vi.fn((path: string, content: string) => {
      documents.set(path, { currentContent: content });
    });
    const { result } = renderHarness({
      workspaceApi: { openFile } as unknown as WorkspaceApi,
      documentsRef: documentStore(documents, openDocument),
      setActiveDocument,
    });

    void act(() => {
      void result.current.openFile("/workspace/A.ets");
      void result.current.openFile("/workspace/C.ets");
    });
    expect(setActiveDocument).toHaveBeenLastCalledWith("/workspace/C.ets");

    await act(async () => {
      pending.resolve("late A");
      await Promise.resolve();
    });

    expect(openDocument).not.toHaveBeenCalledWith("/workspace/A.ets", "late A");
    expect(setActiveDocument).toHaveBeenCalledTimes(1);
  });

  it("keeps the current editor active when document preparation fails", async () => {
    const documents = new Map<string, { currentContent: string }>();
    const openDocument = vi.fn((path: string, content: string) => {
      documents.set(path, { currentContent: content });
    });
    const setActiveDocument = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: { openFile: vi.fn(async () => "broken") } as unknown as WorkspaceApi,
      documentsRef: documentStore(documents, openDocument),
      setActiveDocument,
      onStatusChange,
      prepareDocumentText: vi.fn(async () => {
        throw new Error("prepare failed");
      }),
    });

    await act(async () => {
      await result.current.openFile("/workspace/Broken.ets");
    });

    expect(openDocument).not.toHaveBeenCalled();
    expect(setActiveDocument).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenLastCalledWith("Open failed Broken.ets: prepare failed");
  });

  it("cancels a pending cross-file open before it can activate", async () => {
    const pending = createDeferred<string>();
    const documents = new Map<string, { currentContent: string }>();
    const openDocument = vi.fn((path: string, content: string) => {
      documents.set(path, { currentContent: content });
    });
    const setActiveDocument = vi.fn();
    const { result } = renderHarness({
      workspaceApi: { openFile: vi.fn(() => pending.promise) } as unknown as WorkspaceApi,
      documentsRef: documentStore(documents, openDocument),
      setActiveDocument,
    });

    void act(() => {
      void result.current.openFile("/workspace/A.ets");
      result.current.cancelPendingOpen();
    });
    await act(async () => {
      pending.resolve("late A");
      await Promise.resolve();
    });

    expect(openDocument).not.toHaveBeenCalled();
    expect(setActiveDocument).not.toHaveBeenCalled();
  });
});

function renderHarness(overrides: Partial<Parameters<typeof useEditorSurfaceController>[0]> = {}) {
  const documents = new Map<string, { currentContent: string }>();
  return renderHook(() => useEditorSurfaceController({
    workspaceApi: { openFile: vi.fn(async () => "") } as unknown as WorkspaceApi,
    activePath: null,
    quickOpenQuery: "",
    documentsRef: documentStore(documents),
    tabsRef: { current: { openTab: vi.fn() } },
    syncTabs: vi.fn(),
    setActiveDocument: vi.fn(),
    includeVisibleWorkspaceFile: vi.fn(),
    clearCompletionSession: vi.fn(),
    resetCompletionAnchor: vi.fn(),
    resetCodeActionSession: vi.fn(),
    setEditorSelection: vi.fn(),
    setInsertTextTarget: vi.fn(),
    setSelectionTarget: vi.fn(),
    setActiveOverlay: vi.fn(),
    setQuickOpenQuery: vi.fn(),
    bumpEditorFocusToken: vi.fn(),
    rememberCurrentLocation: vi.fn(),
    focusEditorSoon: vi.fn(),
    syncCompletionForEditorSelection: vi.fn(),
    onStatusChange: vi.fn(),
    scheduleActivation: vi.fn(async () => undefined),
    prepareDocumentText: vi.fn(async (content) => Text.of([content])),
    ...overrides,
  }));
}

function documentStore(
  documents: Map<string, { currentContent: string }>,
  openDocument = vi.fn((path: string, content: string) => {
    documents.set(path, { currentContent: content });
  }),
) {
  return {
    current: {
      getDocument: (path: string) => documents.get(path),
      openDocument,
      updateDocument: (path: string, content: string) => {
        documents.set(path, { currentContent: content });
        return { dirtyChanged: true };
      },
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
