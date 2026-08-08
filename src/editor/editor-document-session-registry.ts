import type { EditorState } from "@codemirror/state";

export type EditorDocumentSession = {
  state: EditorState;
  scrollTop: number;
  scrollLeft: number;
  enhanced: boolean;
};

export const DEFAULT_HOT_EDITOR_SESSION_CAPACITY = 8;
export const DEFAULT_HOT_EDITOR_CHARACTER_BUDGET = 500_000;

export function createEditorDocumentSessionRegistry(
  capacity = DEFAULT_HOT_EDITOR_SESSION_CAPACITY,
  documentCharacterBudget = DEFAULT_HOT_EDITOR_CHARACTER_BUDGET,
) {
  const sessions = new Map<string, EditorDocumentSession>();
  const boundedCapacity = Math.max(1, capacity);
  const boundedCharacterBudget = Math.max(1, documentCharacterBudget);
  let retainedDocumentCharacters = 0;

  return {
    save(path: string, session: EditorDocumentSession) {
      retainedDocumentCharacters -= sessions.get(path)?.state.doc.length ?? 0;
      sessions.delete(path);
      sessions.set(path, session);
      retainedDocumentCharacters += session.state.doc.length;
      while (sessions.size > boundedCapacity || retainedDocumentCharacters > boundedCharacterBudget) {
        const oldestPath = sessions.keys().next().value;
        if (oldestPath === undefined) break;
        retainedDocumentCharacters -= sessions.get(oldestPath)?.state.doc.length ?? 0;
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
      retainedDocumentCharacters -= sessions.get(path)?.state.doc.length ?? 0;
      sessions.delete(path);
    },
    size() {
      return sessions.size;
    },
    retainedDocumentCharacters() {
      return retainedDocumentCharacters;
    },
  };
}
