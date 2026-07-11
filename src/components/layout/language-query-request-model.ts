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

export function buildLanguageQueryRequest(input: LanguageQuerySnapshotInput): LanguageQueryEditorRequest {
  return {
    path: input.activePath,
    line: input.editorSelection.line,
    column: input.editorSelection.column,
    content: input.getActiveContent(),
  };
}
