import type { SemanticTextRange } from "../protocol.js"

export function lineColumnToOffset(content: string, line: number, column: number): number {
  const targetLine = Math.max(1, line)
  let offset = 0
  let currentLine = 1
  while (currentLine < targetLine && offset < content.length) {
    const newline = content.indexOf("\n", offset)
    if (newline < 0) return content.length
    offset = newline + 1
    currentLine += 1
  }
  return Math.min(offset + Math.max(0, column - 1), content.length)
}

export function offsetToLineColumn(content: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, content.length))
  let line = 1
  let lineStart = 0
  for (let index = 0; index < bounded; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1
      lineStart = index + 1
    }
  }
  return { line, column: bounded - lineStart + 1 }
}

export function spanToRange(content: string, start: number, length: number): SemanticTextRange {
  const from = offsetToLineColumn(content, start)
  const to = offsetToLineColumn(content, start + length)
  return {
    startLine: from.line,
    startColumn: from.column,
    endLine: to.line,
    endColumn: to.column,
  }
}
