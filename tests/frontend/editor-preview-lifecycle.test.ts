import { createDocumentStore } from "@/features/documents/document-store";
import { createEditorTabsStore } from "@/features/documents/editor-tabs-store";

describe("editor preview lifecycle", () => {
  it("keeps transient navigation bounded to one clean preview document", () => {
    const documents = createDocumentStore();
    const tabs = createEditorTabsStore(documents);

    for (let index = 0; index < 1_000; index += 1) {
      const path = `/workspace/Page${index}.ets`;
      documents.openDocument(path, `content ${index}`);
      tabs.openTab(path, "preview");
    }

    expect(tabs.state.openTabs).toHaveLength(1);
    expect(tabs.state.openTabs[0]).toMatchObject({
      path: "/workspace/Page999.ets",
      isPreview: true,
    });
    expect(documents.getDocuments()).toHaveLength(1);
  });

  it("pins an edited preview instead of evicting it", () => {
    const documents = createDocumentStore();
    const tabs = createEditorTabsStore(documents);

    documents.openDocument("/workspace/A.ets", "A");
    tabs.openTab("/workspace/A.ets", "preview");
    documents.updateDocument("/workspace/A.ets", "A edited");
    documents.openDocument("/workspace/B.ets", "B");
    tabs.openTab("/workspace/B.ets", "preview");

    expect(tabs.state.openTabs).toEqual([
      {
        path: "/workspace/A.ets",
        title: "A.ets",
        isDirty: true,
      },
      {
        path: "/workspace/B.ets",
        title: "B.ets",
        isDirty: false,
        isPreview: true,
      },
    ]);
    expect(documents.getDocument("/workspace/A.ets")?.currentContent).toBe("A edited");
  });

  it("never demotes an existing pinned tab to preview", () => {
    const documents = createDocumentStore();
    const tabs = createEditorTabsStore(documents);

    documents.openDocument("/workspace/A.ets", "A");
    tabs.openTab("/workspace/A.ets");
    tabs.openTab("/workspace/A.ets", "preview");

    expect(tabs.state.openTabs[0]?.isPreview).not.toBe(true);
  });
});
