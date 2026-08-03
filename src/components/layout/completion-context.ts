export type CompletionPosition = {
  content?: string;
  lineText?: string;
  line: number;
  column: number;
};

export function isMemberAccessCompletion({ content = "", lineText, line, column }: CompletionPosition): boolean {
  const activeLineText = lineText ?? content.split(/\r?\n/)[line - 1] ?? "";
  const before = activeLineText.slice(0, Math.max(column - 1, 0));
  return /(?:\?\.|\.)\s*[A-Za-z_$][A-Za-z0-9_$]*$/u.test(before)
    || /(?:\?\.|\.)\s*$/u.test(before);
}
