import { isLargeEditorDocument } from "@/editor/editor-document-budget";

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
    },
  };
}
