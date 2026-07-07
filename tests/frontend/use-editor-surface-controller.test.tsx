import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorSurfaceController } from "@/components/layout/use-editor-surface-controller";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("useEditorSurfaceController", () => {
  it("keeps the latest opened file active when older file loads finish later", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const openFile = vi.fn((path: string) => path.endsWith("A.ets") ? first.promise : second.promise);
    const setActiveDocument = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHarness({
      workspaceApi: { openFile } as unknown as WorkspaceApi,
      setActiveDocument,
      onStatusChange,
    });

    void act(() => {
      void result.current.openFile("/workspace/A.ets");
      void result.current.openFile("/workspace/B.ets");
    });
    await act(async () => {
      second.resolve("B content");
      await Promise.resolve();
    });

    expect(setActiveDocument).toHaveBeenLastCalledWith("/workspace/B.ets");

    await act(async () => {
      first.resolve("A content");
      await Promise.resolve();
    });

    expect(setActiveDocument).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenLastCalledWith("Opened B.ets");
  });

  it("does not cache stale file content when users rapidly switch jump targets", async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const documents = new Map<string, { currentContent: string }>();
    const openDocument = vi.fn((path: string, content: string) => {
      documents.set(path, { currentContent: content });
    });
    const openFile = vi.fn((path: string) => path.endsWith("A.ets") ? first.promise : second.promise);
    const { result } = renderHarness({
      workspaceApi: { openFile } as unknown as WorkspaceApi,
      documentsRef: {
        current: {
          getDocument: (path: string) => documents.get(path),
          openDocument,
          updateDocument: (path: string, content: string) => {
            documents.set(path, { currentContent: content });
            return { dirtyChanged: true };
          },
        },
      },
    });

    void act(() => {
      void result.current.openFile("/workspace/A.ets");
      void result.current.openFile("/workspace/B.ets");
    });
    await act(async () => {
      second.resolve("B content");
      await Promise.resolve();
    });
    await act(async () => {
      first.resolve("A stale content");
      await Promise.resolve();
    });

    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(openDocument).toHaveBeenCalledWith("/workspace/B.ets", "B content");
    expect(documents.has("/workspace/A.ets")).toBe(false);
  });

  it("only applies the last file when many jump targets resolve out of order", async () => {
    const requests = Array.from({ length: 20 }, () => createDeferred<string>());
    const documents = new Map<string, { currentContent: string }>();
    const openDocument = vi.fn((path: string, content: string) => {
      documents.set(path, { currentContent: content });
    });
    const openTab = vi.fn();
    const setActiveDocument = vi.fn();
    const openFile = vi.fn((path: string) => {
      const index = Number(path.match(/File(\d+)\.ets$/)?.[1] ?? "0");
      return requests[index]?.promise ?? Promise.resolve("");
    });
    const { result } = renderHarness({
      workspaceApi: { openFile } as unknown as WorkspaceApi,
      documentsRef: {
        current: {
          getDocument: (path: string) => documents.get(path),
          openDocument,
          updateDocument: (path: string, content: string) => {
            documents.set(path, { currentContent: content });
            return { dirtyChanged: true };
          },
        },
      },
      tabsRef: {
        current: { openTab },
      },
      setActiveDocument,
    });

    void act(() => {
      for (let index = 0; index < requests.length; index += 1) {
        void result.current.openFile(`/workspace/File${index}.ets`);
      }
    });

    for (let index = requests.length - 1; index >= 0; index -= 1) {
      await act(async () => {
        requests[index]?.resolve(`content ${index}`);
        await Promise.resolve();
      });
    }

    expect(openDocument).toHaveBeenCalledTimes(1);
    expect(openDocument).toHaveBeenCalledWith("/workspace/File19.ets", "content 19");
    expect(openTab).toHaveBeenCalledTimes(1);
    expect(openTab).toHaveBeenCalledWith("/workspace/File19.ets");
    expect(setActiveDocument).toHaveBeenCalledTimes(1);
    expect(setActiveDocument).toHaveBeenCalledWith("/workspace/File19.ets");
  });

  it("keeps typing updates in the document store without syncing root editor content", () => {
    const documents = new Map<string, { currentContent: string; originalContent: string; isDirty: boolean }>();
    documents.set("/workspace/A.ets", {
      currentContent: "initial",
      originalContent: "initial",
      isDirty: false,
    });
    const syncTabs = vi.fn();
    const setActiveDocument = vi.fn();
    const { result } = renderHarness({
      activePath: "/workspace/A.ets",
      documentsRef: {
        current: {
          getDocument: (path: string) => documents.get(path),
          openDocument: (path: string, content: string) => documents.set(path, {
            currentContent: content,
            originalContent: content,
            isDirty: false,
          }),
          updateDocument: (path: string, content: string) => {
            const record = documents.get(path);
            if (!record) throw new Error("missing document");
            const wasDirty = record.isDirty;
            record.currentContent = content;
            record.isDirty = record.currentContent !== record.originalContent;
            return { dirtyChanged: wasDirty !== record.isDirty };
          },
        },
      },
      syncTabs,
      setActiveDocument,
    });

    act(() => {
      result.current.handleEditorChange("initial ");
      result.current.handleEditorChange("initial text");
      result.current.handleEditorChange("initial text!");
    });

    expect(documents.get("/workspace/A.ets")?.currentContent).toBe("initial text!");
    expect(syncTabs).toHaveBeenCalledTimes(1);
    expect(setActiveDocument).not.toHaveBeenCalled();
  });
});

function renderHarness(overrides: Partial<Parameters<typeof useEditorSurfaceController>[0]> = {}) {
  const documents = new Map<string, { currentContent: string }>();
  const tabs = new Set<string>();
  return renderHook(() => useEditorSurfaceController({
    workspaceApi: { openFile: vi.fn(async () => "") } as unknown as WorkspaceApi,
    activePath: null,
    quickOpenQuery: "",
    documentsRef: {
      current: {
        getDocument: (path: string) => documents.get(path),
        openDocument: (path: string, content: string) => documents.set(path, { currentContent: content }),
        updateDocument: (path: string, content: string) => {
          documents.set(path, { currentContent: content });
          return { dirtyChanged: true };
        },
      },
    },
    tabsRef: {
      current: {
        openTab: (path: string) => {
          tabs.add(path);
        },
      },
    },
    syncTabs: vi.fn(),
    setActiveDocument: vi.fn(),
    includeVisibleWorkspaceFile: vi.fn(),
    clearCompletionSession: vi.fn(),
    resetCompletionAnchor: vi.fn(),
    resetCodeActionSession: vi.fn(),
    setEditorSelection: vi.fn(),
    setEditorSelectedText: vi.fn(),
    setInsertTextTarget: vi.fn(),
    setSelectionTarget: vi.fn(),
    setActiveOverlay: vi.fn(),
    setQuickOpenQuery: vi.fn(),
    bumpEditorFocusToken: vi.fn(),
    rememberCurrentLocation: vi.fn(),
    focusEditorSoon: vi.fn(),
    syncCompletionForEditorSelection: vi.fn(),
    onStatusChange: vi.fn(),
    ...overrides,
  }));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
