export type EditorDocumentSession = {
  selectionAnchor: number;
  selectionHead: number;
  scrollTop: number;
  scrollLeft: number;
  enhanced: boolean;
};

// Session metadata is cheap. Keep it aligned with the bounded tab model without
// retaining inactive CodeMirror states, syntax trees, or view plugins.
export const DEFAULT_HOT_EDITOR_SESSION_CAPACITY = 32;

export function createEditorDocumentSessionRegistry(
  capacity = DEFAULT_HOT_EDITOR_SESSION_CAPACITY,
) {
  const sessions = new Map<string, EditorDocumentSession>();
  const boundedCapacity = Math.max(1, capacity);

  return {
    save(path: string, session: EditorDocumentSession) {
      sessions.delete(path);
      sessions.set(path, session);
      while (sessions.size > boundedCapacity) {
        const oldestPath = sessions.keys().next().value;
        if (oldestPath === undefined) break;
        sessions.delete(oldestPath);
      }
    },
    restore(path: string) {
      const session = sessions.get(path);
      if (!session) return undefined;
      sessions.delete(path);
      sessions.set(path, session);
      return session;
    },
    delete(path: string) {
      sessions.delete(path);
    },
    size() {
      return sessions.size;
    },
    retainedDocumentCharacters() {
      return 0;
    },
  };
}
