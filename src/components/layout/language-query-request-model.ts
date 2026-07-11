import { isLargeEditorDocument } from "@/editor/editor-document-budget";

export const LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD = 1_000_000;

export type LanguageQueryContentClass = "normal" | "large" | "oversized";

export type LanguageQuerySnapshotInput = {
  activePath: string;
  editorSelection: { line: number; column: number };
  getActiveContent: () => string;
};

export type LanguageQueryEditorRequest = {
  path: string;
  line: number;
  column: number;
  content: string;
};

export type LanguageQuerySnapshot = {
  request: LanguageQueryEditorRequest;
  meta: {
    contentLength: number;
    largeDocument: boolean;
    contentClass: LanguageQueryContentClass;
  };
};

export function buildLanguageQueryRequest(input: LanguageQuerySnapshotInput): LanguageQueryEditorRequest {
  return buildLanguageQuerySnapshot(input).request;
}

export function buildLanguageQuerySnapshot(input: LanguageQuerySnapshotInput): LanguageQuerySnapshot {
  const content = input.getActiveContent();
  return {
    request: {
      path: input.activePath,
      line: input.editorSelection.line,
      column: input.editorSelection.column,
      content,
    },
    meta: {
      contentLength: content.length,
      largeDocument: isLargeEditorDocument(content),
      contentClass: classifyLanguageQueryContent(content),
    },
  };
}

export function classifyLanguageQueryContent(content: string): LanguageQueryContentClass {
  if (content.length >= LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD) {
    return "oversized";
  }
  return isLargeEditorDocument(content) ? "large" : "normal";
}
