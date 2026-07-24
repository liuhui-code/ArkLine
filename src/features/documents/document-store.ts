import { Text } from "@codemirror/state";
import { normalizePath } from "@/features/workspace/workspace-store";

export type DocumentNotificationKind = "content" | "metadata";

export type DocumentRecord = {
  path: string;
  originalContent: string;
  readonly currentContent: string;
  isDirty: boolean;
  externalContent: string | null;
};

type InternalDocumentRecord = DocumentRecord & {
  currentText: Text;
  originalText: Text;
  currentSnapshot: string | null;
};

export type ExternalChangeResult = "updated" | "conflict";

export function createDocumentStore() {
  const documents = new Map<string, InternalDocumentRecord>();
  const listeners = new Set<(
    path: string,
    document: DocumentRecord,
    kind: DocumentNotificationKind,
  ) => void>();
  const pendingNotifications = new Map<string, {
    document: InternalDocumentRecord;
    kind: DocumentNotificationKind;
  }>();
  let notificationScheduled = false;
  let dirtyCount = 0;

  function notify(path: string, document: InternalDocumentRecord, kind: DocumentNotificationKind) {
    if (kind === "metadata") {
      listeners.forEach((listener) => listener(path, document, kind));
      return;
    }
    const pending = pendingNotifications.get(path);
    pendingNotifications.set(path, {
      document,
      kind: pending?.kind === "content" ? "content" : kind,
    });
    if (notificationScheduled) return;
    notificationScheduled = true;
    queueMicrotask(() => {
      notificationScheduled = false;
      const notifications = [...pendingNotifications.entries()];
      pendingNotifications.clear();
      notifications.forEach(([pendingPath, pendingNotification]) => {
        listeners.forEach((listener) => listener(
          pendingPath,
          pendingNotification.document,
          pendingNotification.kind,
        ));
      });
    });
  }

  function setDirtyState(document: InternalDocumentRecord, nextDirty: boolean) {
    if (document.isDirty === nextDirty) return false;
    dirtyCount += nextDirty ? 1 : -1;
    document.isDirty = nextDirty;
    return true;
  }

  function replaceText(document: InternalDocumentRecord, text: Text, snapshot: string | null) {
    document.currentText = text;
    document.currentSnapshot = snapshot;
  }

  function openDocumentText(path: string, content: string, text: Text) {
    const normalized = normalizePath(path);
    const existing = documents.get(normalized);
    if (existing?.isDirty) dirtyCount -= 1;
    const document = createDocumentRecord(normalized, content, text);
    documents.set(normalized, document);
    notify(normalized, document, "content");
  }

  return {
    openDocument(path: string, content: string) {
      openDocumentText(path, content, textFromString(content));
    },
    openDocumentText,
    updateDocument(path: string, content: string) {
      const normalized = normalizePath(path);
      const existing = requireDocument(documents, normalized);
      const wasDirty = existing.isDirty;
      replaceText(existing, textFromString(content), content);
      const dirtyChanged = setDirtyState(existing, content !== existing.originalContent);
      if (dirtyChanged) notify(normalized, existing, "metadata");
      notify(normalized, existing, "content");
      return { dirtyChanged: wasDirty !== existing.isDirty };
    },
    applyEditorDocument(path: string, document: Text) {
      const normalized = normalizePath(path);
      const existing = requireDocument(documents, normalized);
      replaceText(existing, document, null);
      const dirtyChanged = setDirtyState(existing, !document.eq(existing.originalText));
      if (dirtyChanged) notify(normalized, existing, "metadata");
      return { dirtyChanged };
    },
    applyExternalChange(path: string, content: string): ExternalChangeResult {
      const normalized = normalizePath(path);
      const existing = requireDocument(documents, normalized);
      if (existing.isDirty) {
        existing.externalContent = content;
        notify(normalized, existing, "metadata");
        return "conflict";
      }
      const text = textFromString(content);
      existing.originalContent = content;
      existing.originalText = text;
      replaceText(existing, text, content);
      existing.externalContent = null;
      setDirtyState(existing, false);
      notify(normalized, existing, "content");
      return "updated";
    },
    saveDocument(path: string) {
      const normalized = normalizePath(path);
      const existing = requireDocument(documents, normalized);
      existing.originalContent = existing.currentContent;
      existing.originalText = existing.currentText;
      existing.externalContent = null;
      setDirtyState(existing, false);
      notify(normalized, existing, "metadata");
    },
    getDocument(path: string): DocumentRecord | undefined {
      return documents.get(normalizePath(path));
    },
    getDocumentLength(path: string) {
      return documents.get(normalizePath(path))?.currentText.length;
    },
    getDocumentText(path: string) {
      return documents.get(normalizePath(path))?.currentText;
    },
    getDocumentSlice(path: string, start: number, end: number) {
      return documents.get(normalizePath(path))?.currentText.sliceString(start, end);
    },
    getDocuments(): DocumentRecord[] {
      return [...documents.values()];
    },
    releaseDocument(path: string) {
      const normalized = normalizePath(path);
      const existing = documents.get(normalized);
      if (!existing || existing.isDirty) return false;
      pendingNotifications.delete(normalized);
      return documents.delete(normalized);
    },
    hasDirtyDocuments() {
      return dirtyCount > 0;
    },
    subscribe(listener: (
      path: string,
      document: DocumentRecord,
      kind: DocumentNotificationKind,
    ) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function createDocumentRecord(path: string, content: string, text: Text): InternalDocumentRecord {
  return {
    path,
    originalContent: content,
    currentText: text,
    originalText: text,
    currentSnapshot: content,
    get currentContent() {
      if (this.currentSnapshot == null) this.currentSnapshot = this.currentText.toString();
      return this.currentSnapshot;
    },
    isDirty: false,
    externalContent: null,
  };
}

function requireDocument(documents: Map<string, InternalDocumentRecord>, path: string) {
  const document = documents.get(path);
  if (!document) throw new Error(`Document not open: ${path}`);
  return document;
}

function textFromString(content: string) {
  return Text.of(content.split("\n"));
}
