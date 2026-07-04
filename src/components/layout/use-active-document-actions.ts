import type { MutableRefObject } from "react";
import { formatArkTsDocument } from "@/features/documents/arkts-format";
import type { createDocumentStore } from "@/features/documents/document-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

type DocumentStore = ReturnType<typeof createDocumentStore>;

export type UseActiveDocumentActionsOptions = {
  activePath: string | null;
  editorContent: string;
  documentsRef: MutableRefObject<DocumentStore>;
  syncTabs: () => void;
  setEditorContent: (content: string) => void;
  saveFile: (path: string, content: string) => Promise<void>;
  getFormatOnSave: () => boolean;
  refreshProblems: (path: string, content: string) => Promise<void>;
  showProblems: () => void;
  refreshBlame: () => void;
  onStatusChange: (message: string) => void;
};

export function useActiveDocumentActions({
  activePath,
  editorContent,
  documentsRef,
  syncTabs,
  setEditorContent,
  saveFile,
  getFormatOnSave,
  refreshProblems,
  showProblems,
  refreshBlame,
  onStatusChange,
}: UseActiveDocumentActionsOptions) {
  async function formatActiveDocument() {
    if (!activePath) return;
    const content = documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
    const formatted = formatArkTsDocument(content);
    documentsRef.current.updateDocument(activePath, formatted);
    syncTabs();
    setEditorContent(formatted);
    await refreshProblems(activePath, formatted);
    showProblems();
    onStatusChange(`Formatted ${getPathBasename(activePath)}`);
  }

  async function saveActiveDocument() {
    if (!activePath) return;
    const currentContent = documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
    const content = getFormatOnSave()
      ? formatArkTsDocument(currentContent)
      : currentContent;
    if (content !== currentContent) documentsRef.current.updateDocument(activePath, content);
    await saveFile(activePath, content);
    documentsRef.current.saveDocument(activePath);
    syncTabs();
    setEditorContent(content);
    refreshBlame();
    await refreshProblems(activePath, content);
    onStatusChange(`Saved ${getPathBasename(activePath)}`);
  }

  return { formatActiveDocument, saveActiveDocument };
}
