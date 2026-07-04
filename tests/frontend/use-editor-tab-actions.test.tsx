import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorDocuments } from "@/components/layout/use-editor-documents";
import { useEditorTabActions } from "@/components/layout/use-editor-tab-actions";

describe("useEditorTabActions", () => {
  it("closes active files and updates active document state", () => {
    const onStatusChange = vi.fn();
    const onFocusEditorSoon = vi.fn();
    const resetTransientEditorTargets = vi.fn();
    const { result } = renderHook(() => {
      const documents = useEditorDocuments();
      const actions = useEditorTabActions({
        tabsRef: documents.tabsRef,
        activePath: documents.activePath,
        syncTabs: documents.syncTabs,
        setActiveDocument: documents.setActiveDocument,
        resetTransientEditorTargets,
        onStatusChange,
        onFocusEditorSoon,
      });
      return { documents, actions };
    });

    act(() => {
      result.current.documents.documentsRef.current.openDocument("/workspace/A.ets", "A");
      result.current.documents.documentsRef.current.openDocument("/workspace/B.ets", "B");
      result.current.documents.tabsRef.current.openTab("/workspace/A.ets");
      result.current.documents.tabsRef.current.openTab("/workspace/B.ets");
      result.current.documents.syncTabs();
      result.current.documents.setActiveDocument("/workspace/B.ets");
    });

    act(() => result.current.actions.closeActiveFile());
    expect(result.current.documents.activePath).toBe("/workspace/A.ets");
    expect(result.current.documents.openTabs.map((tab) => tab.path)).toEqual(["/workspace/A.ets"]);
    expect(resetTransientEditorTargets).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Closed B.ets");
    expect(onFocusEditorSoon).toHaveBeenCalledTimes(1);
  });

  it("closes other tabs around the selected tab", () => {
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => {
      const documents = useEditorDocuments();
      const actions = useEditorTabActions({
        tabsRef: documents.tabsRef,
        activePath: documents.activePath,
        syncTabs: documents.syncTabs,
        setActiveDocument: documents.setActiveDocument,
        resetTransientEditorTargets: vi.fn(),
        onStatusChange,
        onFocusEditorSoon: vi.fn(),
      });
      return { documents, actions };
    });

    act(() => {
      ["/workspace/A.ets", "/workspace/B.ets", "/workspace/C.ets"].forEach((path) => {
        result.current.documents.documentsRef.current.openDocument(path, path);
        result.current.documents.tabsRef.current.openTab(path);
      });
      result.current.documents.syncTabs();
      result.current.actions.closeOtherEditorTabs("/workspace/B.ets");
    });

    expect(result.current.documents.openTabs.map((tab) => tab.path)).toEqual(["/workspace/B.ets"]);
    expect(result.current.documents.activePath).toBe("/workspace/B.ets");
    expect(onStatusChange).toHaveBeenCalledWith("Closed other tabs for B.ets");
  });
});
