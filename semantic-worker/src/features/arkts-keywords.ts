import type { SemanticCompletionItem, SemanticDocumentPosition } from "../protocol.js"

const ARKTS_KEYWORDS: SemanticCompletionItem[] = [
  { label: "public", detail: "ArkTS access modifier", kind: "keyword", source: "arkts" },
  { label: "private", detail: "ArkTS access modifier", kind: "keyword", source: "arkts" },
  { label: "protected", detail: "ArkTS access modifier", kind: "keyword", source: "arkts" },
  { label: "readonly", detail: "ArkTS property modifier", kind: "keyword", source: "arkts" },
  { label: "static", detail: "ArkTS member modifier", kind: "keyword", source: "arkts" },
  { label: "async", detail: "ArkTS async modifier", kind: "keyword", source: "arkts" },
  { label: "await", detail: "ArkTS async keyword", kind: "keyword", source: "arkts" },
  { label: "class", detail: "ArkTS declaration keyword", kind: "keyword", source: "arkts" },
  { label: "struct", detail: "ArkTS declaration keyword", kind: "keyword", source: "arkts" },
  { label: "interface", detail: "ArkTS declaration keyword", kind: "keyword", source: "arkts" },
  { label: "enum", detail: "ArkTS declaration keyword", kind: "keyword", source: "arkts" },
  { label: "type", detail: "ArkTS declaration keyword", kind: "keyword", source: "arkts" },
  { label: "function", detail: "ArkTS declaration keyword", kind: "keyword", source: "arkts" },
  { label: "let", detail: "ArkTS variable declaration", kind: "keyword", source: "arkts" },
  { label: "const", detail: "ArkTS variable declaration", kind: "keyword", source: "arkts" },
  { label: "return", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "if", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "else", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "for", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "while", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "switch", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "case", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "default", detail: "ArkTS control flow keyword", kind: "keyword", source: "arkts" },
  { label: "import", detail: "ArkTS module keyword", kind: "keyword", source: "arkts" },
  { label: "export", detail: "ArkTS module keyword", kind: "keyword", source: "arkts" },
]

export function completeArktsKeywords(
  content: string,
  position: SemanticDocumentPosition,
): SemanticCompletionItem[] {
  if (isMemberAccessContext(content, position)) {
    return []
  }

  const prefix = completionPrefix(content, position)
  if (!prefix) {
    return []
  }

  return ARKTS_KEYWORDS
}

function isMemberAccessContext(content: string, position: SemanticDocumentPosition) {
  const lineText = content.split(/\r?\n/)[position.line - 1] ?? ""
  const before = lineText.slice(0, Math.max(position.column - 1, 0))
  return /\.\s*[A-Za-z_$][A-Za-z0-9_$]*$/.test(before)
}

function completionPrefix(content: string, position: SemanticDocumentPosition) {
  const lineText = content.split(/\r?\n/)[position.line - 1] ?? ""
  const before = lineText.slice(0, Math.max(position.column - 1, 0))
  return before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/)?.[0] ?? ""
}
