import type { Text } from "@codemirror/state";

export const LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD = 300_000;
export const EDITOR_REDUCED_RENDER_CHARACTER_THRESHOLD = 96_000;
export const EDITOR_REDUCED_RENDER_LINE_THRESHOLD = 2_000;
export const EDITOR_REDUCED_RENDER_MAX_LINE_LENGTH = 20_000;

type EditorDocumentSource = string | Text;

export function isLargeEditorDocument(value: EditorDocumentSource) {
  return value.length >= LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD;
}

export function isEditorReducedPerformanceDocument(value: EditorDocumentSource) {
  if (value.length >= EDITOR_REDUCED_RENDER_CHARACTER_THRESHOLD) {
    return true;
  }

  if (typeof value !== "string") {
    if (value.lines >= EDITOR_REDUCED_RENDER_LINE_THRESHOLD) {
      return true;
    }
    for (let lineNumber = 1; lineNumber <= value.lines; lineNumber += 1) {
      if (value.line(lineNumber).length >= EDITOR_REDUCED_RENDER_MAX_LINE_LENGTH) {
        return true;
      }
    }
    return false;
  }

  let lineCount = 1;
  let lineLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 10) {
      lineLength += 1;
      if (lineLength >= EDITOR_REDUCED_RENDER_MAX_LINE_LENGTH) {
        return true;
      }
      continue;
    }

    lineCount += 1;
    lineLength = 0;
    if (lineCount >= EDITOR_REDUCED_RENDER_LINE_THRESHOLD) {
      return true;
    }
  }

  return false;
}
