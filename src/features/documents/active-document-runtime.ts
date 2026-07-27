import type { Text } from "@codemirror/state";

export type ActiveDocumentRuntime = {
  getActiveContent: () => string;
  getActiveContentLength: () => number;
  getActiveContentSlice: (start: number, end: number) => string;
  getActiveContentWindow: (selection: { line: number; column: number }, budget: number) => string;
};

type DocumentLookupRef = {
  current: {
    getDocument(path: string): { currentContent: string } | undefined;
    getDocumentLength?(path: string): number | undefined;
    getDocumentSlice?(path: string, start: number, end: number): string | undefined;
    getDocumentText?(path: string): Text | undefined;
  };
};

export function createActiveDocumentRuntime(
  documentsRef: DocumentLookupRef,
  getActivePath: () => string | null,
): ActiveDocumentRuntime {
  function getCurrentContent() {
    const activePath = getActivePath();
    return activePath ? documentsRef.current.getDocument(activePath)?.currentContent ?? "" : "";
  }

  function getCurrentPath() {
    return getActivePath();
  }

  return {
    getActiveContent: getCurrentContent,
    getActiveContentLength: () => {
      const path = getCurrentPath();
      return path ? documentsRef.current.getDocumentLength?.(path) ?? getCurrentContent().length : 0;
    },
    getActiveContentSlice: (start, end) => {
      const path = getCurrentPath();
      return path ? documentsRef.current.getDocumentSlice?.(path, start, end) ?? getCurrentContent().slice(start, end) : "";
    },
    getActiveContentWindow: (selection, budget) => {
      const path = getCurrentPath();
      const text = path ? documentsRef.current.getDocumentText?.(path) : undefined;
      return text
        ? buildContentWindow(text, selection, budget)
        : getCurrentContent();
    },
  };
}

function buildContentWindow(
  text: Text,
  selection: { line: number; column: number },
  budget: number,
) {
  if (text.length <= budget) return text.toString();
  const targetLineNumber = Math.min(Math.max(selection.line, 1), text.lines);
  const headerBudget = Math.min(16_000, Math.floor(budget / 4));
  let headerEndLine = 1;
  while (headerEndLine < targetLineNumber) {
    const next = text.line(headerEndLine + 1);
    if (next.to > headerBudget) break;
    headerEndLine += 1;
  }
  if (targetLineNumber <= headerEndLine + 1) {
    return text.sliceString(0, budget);
  }

  const localStartLine = Math.max(headerEndLine + 1, targetLineNumber - 120);
  const header = text.sliceString(0, text.line(headerEndLine).to);
  const linePadding = "\n".repeat(localStartLine - headerEndLine);
  const localStart = text.line(localStartLine).from;
  const targetLine = text.line(targetLineNumber);
  const targetOffset = Math.min(targetLine.from + Math.max(selection.column - 1, 0), targetLine.to);
  const available = budget - header.length - linePadding.length;
  if (available <= 0 || targetOffset - localStart >= available) {
    return text.toString();
  }
  return header + linePadding + text.sliceString(localStart, Math.min(text.length, localStart + available));
}
