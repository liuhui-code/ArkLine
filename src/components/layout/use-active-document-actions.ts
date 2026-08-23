import type { MutableRefObject } from "react";
import { formatArkTsDocument } from "@/features/documents/arkts-format";
import type { createDocumentStore } from "@/features/documents/document-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

type DocumentStore = ReturnType<typeof createDocumentStore>;

export type UseActiveDocumentActionsOptions = {
  activePath: string | null;
  documentsRef: MutableRefObject<DocumentStore>;
  syncTabs: () => void;
  saveFile: (path: string, content: string, expectedContent?: string) => Promise<void>;
  getFormatOnSave: () => boolean;
  refreshProblems: (path: string, content: string) => Promise<unknown>;
  showProblems: () => void;
  refreshBlame: () => void;
  onStatusChange: (message: string) => void;
};

export function useActiveDocumentActions({
  activePath,
  documentsRef,
  syncTabs,
  saveFile,
  getFormatOnSave,
  refreshProblems,
  showProblems,
  refreshBlame,
  onStatusChange,
}: UseActiveDocumentActionsOptions) {
  async function formatActiveDocument() {
    if (!activePath) return;
    const content = documentsRef.current.getDocument(activePath)?.currentContent ?? "";
    const formatted = formatArkTsDocument(content);
    documentsRef.current.updateDocument(activePath, formatted);
    syncTabs();
    await refreshProblems(activePath, formatted);
    showProblems();
    onStatusChange(`Formatted ${getPathBasename(activePath)}`);
  }

  async function saveActiveDocument() {
    if (!activePath) return;
    const document = documentsRef.current.getDocument(activePath);
    if (document?.externalDeleted) {
      onStatusChange(`Save blocked: ${getPathBasename(activePath)} was deleted outside the editor`);
      return;
    }
    if (document?.externalContent !== null && document?.externalContent !== undefined) {
      onStatusChange(`Save blocked: ${getPathBasename(activePath)} changed on disk`);
      return;
    }
    const currentContent = document?.currentContent ?? "";
    const content = getFormatOnSave()
      ? formatArkTsDocument(currentContent)
      : currentContent;
    if (content !== currentContent) documentsRef.current.updateDocument(activePath, content);
    try {
      await saveFile(activePath, content, document?.originalContent ?? "");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(message.toLowerCase().includes("changed on disk")
        ? `Save blocked: ${getPathBasename(activePath)} changed on disk`
        : `Save failed: ${message}`);
      return;
    }
    documentsRef.current.saveDocument(activePath);
    syncTabs();
    refreshBlame();
    await refreshProblems(activePath, content);
    onStatusChange(`Saved ${getPathBasename(activePath)}`);
  }

  return { formatActiveDocument, saveActiveDocument };
}
