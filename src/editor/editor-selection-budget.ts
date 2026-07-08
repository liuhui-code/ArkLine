import type { Text } from "@codemirror/state";

export const MAX_EDITOR_SELECTED_TEXT_LENGTH = 4096;

export function readSelectedTextWithinBudget(doc: Text, from: number, to: number) {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end || end - start > MAX_EDITOR_SELECTED_TEXT_LENGTH) {
    return undefined;
  }
  return doc.sliceString(start, end);
}
