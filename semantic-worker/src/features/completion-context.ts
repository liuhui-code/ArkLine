import type { SemanticDocumentPosition } from "../protocol.js"

export function isMemberAccessCompletion(
  content: string,
  position: SemanticDocumentPosition,
): boolean {
  const lineText = content.split(/\r?\n/)[position.line - 1] ?? ""
  const before = lineText.slice(0, Math.max(position.column - 1, 0))
  return /(?:\?\.|\.)\s*[A-Za-z_$][A-Za-z0-9_$]*$/.test(before)
    || /(?:\?\.|\.)\s*$/.test(before)
}
