import fs from "node:fs"

import type { SemanticDocumentPosition } from "../protocol.js"

export interface DocumentSymbol {
  path?: string
  name: string
  kind: string
  line: number
  column: number
}

export interface DocumentMethodSymbol extends DocumentSymbol {
  signature: string
  detail: string
}

const DECLARATION_KEYWORDS = ["struct", "class", "interface", "enum", "type", "function", "namespace"]

export function readDocument(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf8")
  } catch {
    return null
  }
}

export function collectDocumentSymbols(content: string): DocumentSymbol[] {
  return collectDocumentSymbolsForPath(content)
}

export function collectDocumentSymbolsForPath(
  content: string,
  documentPath?: string,
): DocumentSymbol[] {
  return content.split(/\r?\n/).flatMap((lineText, index) => {
    for (const keyword of DECLARATION_KEYWORDS) {
      const declaration = `${keyword} `
      const start = lineText.indexOf(declaration)
      if (start < 0) {
        continue
      }

      const nameStart = start + declaration.length
      const name = takeIdentifierPrefix(lineText.slice(nameStart))
      if (!name) {
        continue
      }

      return [
        {
          path: documentPath,
          name,
          kind: keyword,
          line: index + 1,
          column: nameStart + 1,
        },
      ]
    }

    return []
  })
}

export function collectDocumentMethodSymbolsForPath(
  content: string,
  documentPath?: string,
): DocumentMethodSymbol[] {
  const lines = content.split(/\r?\n/)
  const symbols: DocumentMethodSymbol[] = []
  let lastDocSummary = ""

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? ""
    const summaryMatch = lineText.match(/^\s*\*\s+([^@].*?)\s*$/)
    if (summaryMatch?.[1]) {
      lastDocSummary = summaryMatch[1]
    }

    const methodMatch = lineText.match(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*:\s*([^;{]+);/)
    if (!methodMatch?.[2]) {
      continue
    }

    const name = methodMatch[2]
    symbols.push({
      path: documentPath,
      name,
      kind: "method",
      line: index + 1,
      column: lineText.indexOf(name) + 1,
      signature: lineText.trim(),
      detail: lastDocSummary,
    })
    lastDocSummary = ""
  }

  return symbols
}

export function symbolAtPosition(
  content: string,
  position: SemanticDocumentPosition | undefined,
): string | null {
  if (!position) {
    return null
  }

  const lineText = content.split(/\r?\n/)[position.line - 1]
  if (!lineText) {
    return null
  }

  const bytes = Buffer.from(lineText, "utf8")
  if (bytes.length === 0) {
    return null
  }

  const requested = Math.max(position.column - 1, 0)
  let index = Math.min(requested, bytes.length - 1)

  if (!isIdentifierByte(bytes[index]) && index > 0 && isIdentifierByte(bytes[index - 1])) {
    index -= 1
  }

  if (!isIdentifierByte(bytes[index])) {
    return null
  }

  let start = index
  while (start > 0 && isIdentifierByte(bytes[start - 1])) {
    start -= 1
  }

  let end = index + 1
  while (end < bytes.length && isIdentifierByte(bytes[end])) {
    end += 1
  }

  return bytes.subarray(start, end).toString("utf8")
}

function takeIdentifierPrefix(input: string): string | null {
  const match = input.match(/^[A-Za-z0-9_$]+/)
  return match?.[0] ?? null
}

function isIdentifierByte(value: number | undefined): boolean {
  if (value === undefined) {
    return false
  }

  return (
    (value >= 48 && value <= 57) ||
    (value >= 65 && value <= 90) ||
    (value >= 97 && value <= 122) ||
    value === 95 ||
    value === 36
  )
}
