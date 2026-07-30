import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { gitMutationStatus, useGitDocumentSafety } from "@/components/layout/use-git-document-safety";
import { createDocumentStore } from "@/features/documents/document-store";
import { createEditorTabsStore } from "@/features/documents/editor-tabs-store";

describe("useGitDocumentSafety", () => {
  it("writes current editor content and marks each saved document clean", async () => {
    const store = createDocumentStore();
    store.openDocument("/workspace/first.ets", "before");
    store.updateDocument("/workspace/first.ets", "after");
    const saveFile = vi.fn().mockResolvedValue(undefined);
    const syncTabs = vi.fn();
    const { result } = renderHook(() => useGitDocumentSafety({
      documentsRef: { current: store },
      syncTabs,
      saveFile,
    }));

    expect(result.current.getDirtyDocumentPaths()).toEqual(["/workspace/first.ets"]);
    await act(async () => result.current.saveDirtyDocuments(["/workspace/first.ets"]));

    expect(saveFile).toHaveBeenCalledWith("/workspace/first.ets", "after");
    expect(store.getDocument("/workspace/first.ets")?.isDirty).toBe(false);
    expect(syncTabs).toHaveBeenCalledOnce();
  });

  it("leaves a document dirty when writing it fails", async () => {
    const store = createDocumentStore();
    store.openDocument("/workspace/first.ets", "before");
    store.updateDocument("/workspace/first.ets", "after");
    const syncTabs = vi.fn();
    const { result } = renderHook(() => useGitDocumentSafety({
      documentsRef: { current: store },
      syncTabs,
      saveFile: vi.fn().mockRejectedValue(new Error("Write failed")),
    }));

    await expect(result.current.saveDirtyDocuments(["/workspace/first.ets"])).rejects.toThrow("Write failed");
    expect(store.getDocument("/workspace/first.ets")?.isDirty).toBe(true);
    expect(syncTabs).toHaveBeenCalledOnce();
  });

  it("reloads only affected open documents and synchronizes the language service", async () => {
    const store = createDocumentStore();
    const tabs = createEditorTabsStore(store);
    store.openDocument("/workspace/first.ets", "before");
    store.openDocument("/workspace/second.ets", "untouched");
    tabs.openTab("/workspace/first.ets");
    tabs.openTab("/workspace/second.ets");
    const readFile = vi.fn().mockResolvedValue("after Git");
    const onDocumentChanged = vi.fn();
    const invalidateDocumentCache = vi.fn();
    const { result } = renderHook(() => useGitDocumentSafety({
      rootPath: "/workspace",
      documentsRef: { current: store },
      tabsRef: { current: tabs },
      syncTabs: vi.fn(),
      setActiveDocument: vi.fn(),
      saveFile: vi.fn(),
      readFile,
      invalidateDocumentCache,
      onDocumentChanged,
    }));

    const report = await result.current.reconcileDocuments(["first.ets"]);

    expect(report.updatedPaths).toEqual(["/workspace/first.ets"]);
    expect(readFile).toHaveBeenCalledWith("/workspace/first.ets");
    expect(readFile).toHaveBeenCalledOnce();
    expect(store.getDocument("/workspace/first.ets")?.currentContent).toBe("after Git");
    expect(store.getDocument("/workspace/second.ets")?.currentContent).toBe("untouched");
    expect(invalidateDocumentCache).toHaveBeenCalledWith("/workspace/first.ets");
    expect(onDocumentChanged).toHaveBeenCalledWith("/workspace/first.ets", "after Git");
  });

  it("closes a clean tab only after confirming Git deleted its file", async () => {
    const store = createDocumentStore();
    const tabs = createEditorTabsStore(store);
    store.openDocument("/workspace/deleted.ets", "old");
    tabs.openTab("/workspace/deleted.ets");
    const setActiveDocument = vi.fn();
    const onDocumentClosed = vi.fn();
    const { result } = renderHook(() => useGitDocumentSafety({
      rootPath: "/workspace",
      documentsRef: { current: store },
      tabsRef: { current: tabs },
      syncTabs: vi.fn(),
      setActiveDocument,
      saveFile: vi.fn(),
      readFile: vi.fn().mockRejectedValue(new Error("not found")),
      listWorkspaceDirectory: vi.fn().mockResolvedValue([]),
      onDocumentClosed,
    }));

    const report = await result.current.reconcileDocuments(null);

    expect(report.deletedPaths).toEqual(["/workspace/deleted.ets"]);
    expect(tabs.state.openTabs).toEqual([]);
    expect(store.getDocument("/workspace/deleted.ets")).toBeUndefined();
    expect(onDocumentClosed).toHaveBeenCalledWith("/workspace/deleted.ets");
    expect(setActiveDocument).toHaveBeenCalledWith(null);
  });

  it("keeps a tab when reading fails but the file still exists", async () => {
    const store = createDocumentStore();
    const tabs = createEditorTabsStore(store);
    store.openDocument("/workspace/protected.ets", "old");
    tabs.openTab("/workspace/protected.ets");
    const { result } = renderHook(() => useGitDocumentSafety({
      rootPath: "/workspace",
      documentsRef: { current: store },
      tabsRef: { current: tabs },
      syncTabs: vi.fn(),
      saveFile: vi.fn(),
      readFile: vi.fn().mockRejectedValue(new Error("permission denied")),
      listWorkspaceDirectory: vi.fn().mockResolvedValue([{ name: "protected.ets", path: "/workspace/protected.ets", kind: "file", excluded: false, hasChildren: false }]),
    }));

    const report = await result.current.reconcileDocuments(null);

    expect(report.failedPaths).toEqual(["/workspace/protected.ets"]);
    expect(tabs.state.openTabs).toHaveLength(1);
    expect(store.getDocument("/workspace/protected.ets")?.currentContent).toBe("old");
    expect(gitMutationStatus("Pulled", report)).toBe("Pulled. 1 open file needs attention");
  });
});
