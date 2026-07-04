import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useEditorDocuments } from "@/components/layout/use-editor-documents";

describe("useEditorDocuments", () => {
  it("syncs open tabs and active document content", () => {
    const { result } = renderHook(() => useEditorDocuments());

    act(() => {
      result.current.documentsRef.current.openDocument("/workspace/src/A.ets", "class A {}");
      result.current.tabsRef.current.openTab("/workspace/src/A.ets");
      result.current.syncTabs();
      result.current.setActiveDocument("/workspace/src/A.ets");
    });

    expect(result.current.openTabs).toEqual([
      { path: "/workspace/src/A.ets", title: "A.ets", isDirty: false },
    ]);
    expect(result.current.activePath).toBe("/workspace/src/A.ets");
    expect(result.current.editorContent).toBe("class A {}");
  });

  it("resets tabs without clearing document records", () => {
    const { result } = renderHook(() => useEditorDocuments());

    act(() => {
      result.current.documentsRef.current.openDocument("/workspace/src/A.ets", "class A {}");
      result.current.tabsRef.current.openTab("/workspace/src/A.ets");
      result.current.syncTabs();
      result.current.resetTabs();
      result.current.setActiveDocument(null);
    });

    expect(result.current.openTabs).toEqual([]);
    expect(result.current.tabsRef.current.state.activePath).toBeNull();
    expect(result.current.documentsRef.current.getDocument("/workspace/src/A.ets")?.currentContent).toBe("class A {}");
    expect(result.current.editorContent).toBe("");
  });
});
