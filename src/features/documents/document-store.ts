import { normalizePath } from "@/features/workspace/workspace-store";

export type DocumentRecord = {
  path: string;
  originalContent: string;
  currentContent: string;
  isDirty: boolean;
  externalContent: string | null;
};

export type ExternalChangeResult = "updated" | "conflict";

export function createDocumentStore() {
  const documents = new Map<string, DocumentRecord>();
  const listeners = new Set<(path: string, document: DocumentRecord) => void>();

  function notify(path: string, document: DocumentRecord) {
    listeners.forEach((listener) => listener(path, document));
  }

  return {
    openDocument(path: string, content: string) {
      const normalized = normalizePath(path);
      const document = {
        path: normalized,
        originalContent: content,
        currentContent: content,
        isDirty: false,
        externalContent: null
      };
      documents.set(normalized, document);
      notify(normalized, document);
    },
    updateDocument(path: string, content: string) {
      const normalized = normalizePath(path);
      const existing = documents.get(normalized);

      if (!existing) {
        throw new Error(`Document not open: ${normalized}`);
      }

      existing.currentContent = content;
      existing.isDirty = existing.currentContent !== existing.originalContent;
      notify(normalized, existing);
    },
    applyExternalChange(path: string, content: string): ExternalChangeResult {
      const normalized = normalizePath(path);
      const existing = documents.get(normalized);

      if (!existing) {
        throw new Error(`Document not open: ${normalized}`);
      }

      if (existing.isDirty) {
        existing.externalContent = content;
        notify(normalized, existing);
        return "conflict";
      }

      existing.originalContent = content;
      existing.currentContent = content;
      existing.externalContent = null;
      existing.isDirty = false;
      notify(normalized, existing);
      return "updated";
    },
    saveDocument(path: string) {
      const normalized = normalizePath(path);
      const existing = documents.get(normalized);

      if (!existing) {
        throw new Error(`Document not open: ${normalized}`);
      }

      existing.originalContent = existing.currentContent;
      existing.externalContent = null;
      existing.isDirty = false;
      notify(normalized, existing);
    },
    getDocument(path: string) {
      return documents.get(normalizePath(path));
    },
    getDocuments() {
      return [...documents.values()];
    },
    subscribe(listener: (path: string, document: DocumentRecord) => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    }
  };
}
