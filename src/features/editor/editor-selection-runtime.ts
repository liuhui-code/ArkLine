export type EditorSelectionSnapshot = {
  line: number;
  column: number;
  selectedText: string;
};

export type EditorSelectionUpdate = {
  line: number;
  column: number;
  selectedText?: string;
};

export type EditorSelectionRuntime = ReturnType<typeof createEditorSelectionRuntime>;

export function createEditorSelectionRuntime(initial: EditorSelectionSnapshot = {
  line: 1,
  column: 1,
  selectedText: "",
}) {
  let current = initial;
  const listeners = new Set<() => void>();
  const selection = {
    get line() {
      return current.line;
    },
    get column() {
      return current.column;
    },
  };

  return {
    selection,
    getSnapshot: () => current,
    getLine: () => current.line,
    getSelectedText: () => current.selectedText,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(next: EditorSelectionUpdate) {
      const snapshot = {
        line: next.line,
        column: next.column,
        selectedText: next.selectedText ?? "",
      };
      const result = {
        lineChanged: snapshot.line !== current.line,
        selectedTextChanged: snapshot.selectedText !== current.selectedText,
      };
      current = snapshot;
      if (result.lineChanged || result.selectedTextChanged) {
        listeners.forEach((listener) => listener());
      }
      return result;
    },
  };
}
