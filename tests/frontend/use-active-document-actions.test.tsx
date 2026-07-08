import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useActiveDocumentActions } from "@/components/layout/use-active-document-actions";
import { useEditorDocuments } from "@/components/layout/use-editor-documents";

describe("useActiveDocumentActions", () => {
  it("formats the active document and refreshes problems", async () => {
    const refreshProblems = vi.fn(async () => undefined);
    const showProblems = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => {
      const documents = useEditorDocuments();
      const actions = useActiveDocumentActions({
        activePath: documents.activePath,
        documentsRef: documents.documentsRef,
        syncTabs: documents.syncTabs,
        saveFile: vi.fn(async () => undefined),
        getFormatOnSave: () => false,
        refreshProblems,
        showProblems,
        refreshBlame: vi.fn(),
        onStatusChange,
      });
      return { documents, actions };
    });

    act(() => {
      result.current.documents.documentsRef.current.openDocument("/workspace/A.ets", "const  a=1");
      result.current.documents.tabsRef.current.openTab("/workspace/A.ets");
      result.current.documents.syncTabs();
      result.current.documents.setActiveDocument("/workspace/A.ets");
    });
    await act(async () => {
      await result.current.actions.formatActiveDocument();
    });

    const formatted = result.current.documents.documentsRef.current.getDocument("/workspace/A.ets")?.currentContent;
    expect(formatted).not.toBe("const  a=1");
    expect(refreshProblems).toHaveBeenCalledWith("/workspace/A.ets", formatted);
    expect(showProblems).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Formatted A.ets");
  });

  it("saves the active document and refreshes blame", async () => {
    const saveFile = vi.fn(async () => undefined);
    const refreshBlame = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => {
      const documents = useEditorDocuments();
      const actions = useActiveDocumentActions({
        activePath: documents.activePath,
        documentsRef: documents.documentsRef,
        syncTabs: documents.syncTabs,
        saveFile,
        getFormatOnSave: () => true,
        refreshProblems: vi.fn(async () => undefined),
        showProblems: vi.fn(),
        refreshBlame,
        onStatusChange,
      });
      return { documents, actions };
    });

    act(() => {
      result.current.documents.documentsRef.current.openDocument("/workspace/A.ets", "const  a=1");
      result.current.documents.tabsRef.current.openTab("/workspace/A.ets");
      result.current.documents.syncTabs();
      result.current.documents.setActiveDocument("/workspace/A.ets");
    });
    await act(async () => {
      await result.current.actions.saveActiveDocument();
    });

    const saved = result.current.documents.documentsRef.current.getDocument("/workspace/A.ets")?.currentContent;
    expect(saveFile).toHaveBeenCalledWith("/workspace/A.ets", saved);
    expect(result.current.documents.documentsRef.current.getDocument("/workspace/A.ets")?.isDirty).toBe(false);
    expect(refreshBlame).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Saved A.ets");
  });
});
