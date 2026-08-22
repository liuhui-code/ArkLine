import { createDocumentStore } from "@/features/documents/document-store";
import { reconcileOpenDocumentFileChange } from "@/features/documents/open-document-file-changes";

describe("open document file changes", () => {
  it("reloads a clean open document from disk", async () => {
    const documents = createDocumentStore();
    const path = "C:/samples/DemoWorkspace/src/main.ets";
    documents.openDocument(path, "before");

    await reconcileOpenDocumentFileChange({
      event: {
        rootPath: "C:/samples/DemoWorkspace",
        path,
        kind: "modified",
      },
      documents,
      openFile: async () => "after",
    });

    expect(documents.getDocument(path)).toMatchObject({
      currentContent: "after",
      originalContent: "after",
      externalContent: null,
      isDirty: false,
    });
  });

  it("marks a dirty open document conflicted when its file changes outside the editor", async () => {
    const documents = createDocumentStore();
    const path = "C:/samples/DemoWorkspace/src/main.ets";
    documents.openDocument(path, "@Entry\n@Component\nstruct Index {}");
    documents.updateDocument(path, "@Entry\n@Component\nstruct Index {}!");

    await reconcileOpenDocumentFileChange({
      event: {
        rootPath: "C:/samples/DemoWorkspace",
        path,
        kind: "modified",
      },
      documents,
      openFile: async () => "@Entry\n@Component\nstruct ExternalEdit {}",
    });

    expect(documents.getDocument(path)).toMatchObject({
      currentContent: "@Entry\n@Component\nstruct Index {}!",
      externalContent: "@Entry\n@Component\nstruct ExternalEdit {}",
      isDirty: true,
    });
  });
});
