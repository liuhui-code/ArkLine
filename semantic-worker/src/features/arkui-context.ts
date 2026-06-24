import type { SemanticDocumentPosition, SemanticTextRange } from "../protocol.js"

export type ArkuiContext = {
  component: string | null
  symbolPrefix: string
  replacementRange: SemanticTextRange
}

const COMPONENT_CALL = /\b([A-Z][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?:\{|$)/
const CHAIN_CALL = /^\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/

export function findArkuiContext(content: string, position: SemanticDocumentPosition): ArkuiContext | null {
  const lines = content.split(/\r?\n/)
  const lineText = lines[position.line - 1] ?? ""
  const cursorIndex = Math.max(position.column - 1, 0)
  const before = lineText.slice(0, cursorIndex)
  const access = before.match(/(^|\.)\s*([A-Za-z_$][A-Za-z0-9_$]*)?$/)
  if (!access || access[1] !== ".") {
    return null
  }

  const symbolPrefix = access[2] ?? ""
  const prefixStart = cursorIndex - symbolPrefix.length + 1
  const replacementRange = {
    startLine: position.line,
    startColumn: Math.max(prefixStart, 1),
    endLine: position.line,
    endColumn: position.column,
  }

  const sameLineComponent = before.match(/([A-Z][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\.\s*[A-Za-z_$]*$/)
  if (sameLineComponent?.[1]) {
    return { component: sameLineComponent[1], symbolPrefix, replacementRange }
  }

  for (let index = position.line - 2; index >= 0; index -= 1) {
    const candidate = lines[index] ?? ""
    const chained = candidate.match(CHAIN_CALL)
    if (chained) {
      continue
    }
    const component = candidate.match(COMPONENT_CALL)
    if (component?.[1]) {
      return { component: component[1], symbolPrefix, replacementRange }
    }
    if (/^\s*(struct|class|function|if|for|while|switch)\b/.test(candidate)) {
      break
    }
  }

  return { component: null, symbolPrefix, replacementRange }
}
