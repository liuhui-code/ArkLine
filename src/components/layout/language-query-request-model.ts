import { LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD } from "@/editor/editor-document-budget";

export const LANGUAGE_QUERY_CONTENT_BUDGET = 80_000;
export const LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD = 1_000_000;

export type LanguageQueryContentClass = "normal" | "large" | "oversized";

export type LanguageQuerySnapshotInput = {
  activePath: string;
  editorSelection: { line: number; column: number };
  getActiveContent: () => string;
  getActiveContentLength?: () => number;
  getActiveContentSlice?: (start: number, end: number) => string;
  contentBudget?: number;
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
    contentBudgetExceeded: boolean;
  };
};

export function buildLanguageQueryRequest(input: LanguageQuerySnapshotInput): LanguageQueryEditorRequest {
  return buildLanguageQuerySnapshot(input).request;
}

export function buildLanguageQuerySnapshot(input: LanguageQuerySnapshotInput): LanguageQuerySnapshot {
  const budget = input.contentBudget ?? LANGUAGE_QUERY_CONTENT_BUDGET;
  const reportedLength = input.getActiveContentLength?.();
  const getActiveContentSlice = input.getActiveContentSlice;
  const shouldUseBudgetedSlice = reportedLength !== undefined
    && reportedLength > budget
    && getActiveContentSlice;
  const content = shouldUseBudgetedSlice
    ? getActiveContentSlice(0, budget)
    : input.getActiveContent();
  const contentLength = reportedLength ?? content.length;
  return {
    request: {
      path: input.activePath,
      line: input.editorSelection.line,
      column: input.editorSelection.column,
      content,
    },
    meta: {
      contentLength,
      largeDocument: contentLength >= LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD,
      contentClass: classifyLanguageQueryContentLength(contentLength),
      contentBudgetExceeded: contentLength > budget,
    },
  };
}

export function classifyLanguageQueryContent(content: string): LanguageQueryContentClass {
  return classifyLanguageQueryContentLength(content.length);
}

export function classifyLanguageQueryContentLength(contentLength: number): LanguageQueryContentClass {
  if (contentLength >= LANGUAGE_QUERY_OVERSIZED_CONTENT_THRESHOLD) {
    return "oversized";
  }
  return contentLength >= LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD ? "large" : "normal";
}
