import type { EditorState } from "@codemirror/state";

export type EditorDocumentSession = {
  state: EditorState;
  scrollTop: number;
  scrollLeft: number;
  enhanced: boolean;
};

export function createEditorDocumentSessionRegistry(capacity = 32) {
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
  };
}
