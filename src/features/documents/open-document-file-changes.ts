import type { createDocumentStore } from "@/features/documents/document-store";
import type { WorkspaceFileChangeEvent } from "@/features/workspace/workspace-api-contract";

type DocumentStore = ReturnType<typeof createDocumentStore>;

export async function reconcileOpenDocumentFileChange({
  event,
  documents,
  openFile,
}: {
  event: WorkspaceFileChangeEvent;
  documents: DocumentStore;
  openFile: (path: string) => Promise<string>;
}) {
  if (!documents.getDocument(event.path)) {
    return;
  }

  const content = await openFile(event.path);
  documents.applyExternalChange(event.path, content);
}
