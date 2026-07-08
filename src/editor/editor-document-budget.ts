export const LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD = 300_000;

export function isLargeEditorDocument(value: string) {
  return value.length >= LARGE_EDITOR_DOCUMENT_CHARACTER_THRESHOLD;
}
