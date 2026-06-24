import type { SemanticDocumentPosition, SemanticTextRange } from "../protocol.js"

export type ArkuiContext = {
  component: string | null
  symbolPrefix: string
  replacementRange: SemanticTextRange
}

const COMPONENT_CALL = /\b([A-Z][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?:\{|$)/
const CHAIN_CALL = /^\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/
const ACCESS_CHAIN = /^\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)?/

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

  if (/^\s*}\s*\.\s*[A-Za-z_$]*$/.test(before)) {
    const blockComponent = findOwningBlockComponent(lines, position.line - 1)
    return blockComponent ? { component: blockComponent, symbolPrefix, replacementRange } : null
  }

  if (!/^\s*\./.test(before)) {
    return null
  }

  const previousLineIndex = position.line - 2
  if ((lines[previousLineIndex] ?? "").trim() === "}") {
    const blockComponent = findOwningBlockComponent(lines, previousLineIndex)
    return blockComponent ? { component: blockComponent, symbolPrefix, replacementRange } : null
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
    if (isArkuiContextBoundary(candidate)) {
      break
    }
  }

  return { component: null, symbolPrefix, replacementRange }
}

function findOwningBlockComponent(lines: string[], closingBraceIndex: number): string | null {
  let depth = 0
  for (let index = closingBraceIndex; index >= 0; index -= 1) {
    const candidate = lines[index] ?? ""
    for (let charIndex = candidate.length - 1; charIndex >= 0; charIndex -= 1) {
      const char = candidate[charIndex]
      if (char === "}") {
        depth += 1
      } else if (char === "{") {
        depth -= 1
        if (depth === 0) {
          return candidate.match(COMPONENT_CALL)?.[1] ?? null
        }
      }
    }
  }

  return null
}

function isArkuiContextBoundary(lineText: string): boolean {
  const trimmed = lineText.trim()
  return trimmed.length === 0
    || trimmed === "}"
    || trimmed.endsWith(";")
    || (/^\s*(struct|class|function|if|for|while|switch|const|let|var|return)\b/.test(lineText) && !COMPONENT_CALL.test(lineText))
    || (!ACCESS_CHAIN.test(lineText) && !COMPONENT_CALL.test(lineText))
}
