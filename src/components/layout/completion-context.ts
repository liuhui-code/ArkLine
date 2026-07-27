export type CompletionPosition = {
  content: string;
  line: number;
  column: number;
};

export function isMemberAccessCompletion({ content, line, column }: CompletionPosition): boolean {
  const lineText = content.split(/\r?\n/)[line - 1] ?? "";
  const before = lineText.slice(0, Math.max(column - 1, 0));
  return /(?:\?\.|\.)\s*[A-Za-z_$][A-Za-z0-9_$]*$/u.test(before)
    || /(?:\?\.|\.)\s*$/u.test(before);
}
