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
  const pendingNotifications = new Map<string, DocumentRecord>();
  let notificationScheduled = false;
  let dirtyCount = 0;

  function notify(path: string, document: DocumentRecord) {
    pendingNotifications.set(path, document);
    if (notificationScheduled) {
      return;
    }
    notificationScheduled = true;
    queueMicrotask(() => {
      notificationScheduled = false;
      const pending = [...pendingNotifications.entries()];
      pendingNotifications.clear();
      pending.forEach(([pendingPath, pendingDocument]) => {
        listeners.forEach((listener) => listener(pendingPath, pendingDocument));
      });
    });
  }

  function setDirtyState(document: DocumentRecord, nextDirty: boolean) {
    if (document.isDirty === nextDirty) {
      return;
    }
    dirtyCount += nextDirty ? 1 : -1;
    document.isDirty = nextDirty;
  }

  return {
    openDocument(path: string, content: string) {
      const normalized = normalizePath(path);
      const existing = documents.get(normalized);
      if (existing?.isDirty) {
        dirtyCount -= 1;
      }
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

      const wasDirty = existing.isDirty;
      existing.currentContent = content;
      setDirtyState(existing, existing.currentContent !== existing.originalContent);
      notify(normalized, existing);
      return { dirtyChanged: wasDirty !== existing.isDirty };
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
      setDirtyState(existing, false);
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
      setDirtyState(existing, false);
      notify(normalized, existing);
    },
    getDocument(path: string) {
      return documents.get(normalizePath(path));
    },
    getDocuments() {
      return [...documents.values()];
    },
    hasDirtyDocuments() {
      return dirtyCount > 0;
    },
    subscribe(listener: (path: string, document: DocumentRecord) => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    }
  };
}
