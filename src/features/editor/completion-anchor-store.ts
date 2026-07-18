import type { EditorCaretRect } from "@/editor/editor-events";

export type CompletionAnchorStore = ReturnType<typeof createCompletionAnchorStore>;

export function createCompletionAnchorStore(initialAnchor: EditorCaretRect | null = null) {
  let anchor = initialAnchor;
  const listeners = new Set<() => void>();

  const getSnapshot = () => anchor;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const setAnchor = (nextAnchor: EditorCaretRect | null) => {
    if (sameCaretRect(anchor, nextAnchor)) return;
    anchor = nextAnchor;
    listeners.forEach((listener) => listener());
  };

  return {
    getSnapshot,
    subscribe,
    setAnchor,
  };
}

function sameCaretRect(left: EditorCaretRect | null, right: EditorCaretRect | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.left === right.left
    && left.top === right.top
    && left.bottom === right.bottom
    && left.right === right.right
    && left.line === right.line
    && left.column === right.column
    && left.measured === right.measured;
}
