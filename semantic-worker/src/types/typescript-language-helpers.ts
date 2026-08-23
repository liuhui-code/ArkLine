import ts from "typescript"

import type { SemanticDiagnostic } from "../protocol.js"
import type { ArktsVirtualDocument } from "../virtual/arkts-virtual-document.js"
import type { SemanticTypeStatus } from "./type-engine.js"

export function typescriptTypeStatus(filePath: string): SemanticTypeStatus {
  if (filePath.endsWith(".ets")) return "partial"
  if (filePath.endsWith(".ts")) return "ready"
  return "unsupported"
}

export function typescriptTypeDetail(entry: ts.CompletionEntry): string {
  const modifiers = entry.kindModifiers ? ` ${entry.kindModifiers}` : ""
  return `TypeScript ${entry.kind}${modifiers}`
}

export function mapTypescriptDiagnostics(
  filePath: string,
  virtualDocument: ArktsVirtualDocument,
  ...diagnosticGroups: readonly ts.Diagnostic[][]
): SemanticDiagnostic[] {
  const seen = new Set<string>()
  return diagnosticGroups.flat().flatMap((diagnostic) => {
    if (
      diagnostic.start === undefined
      || diagnostic.category !== ts.DiagnosticCategory.Error
        && diagnostic.category !== ts.DiagnosticCategory.Warning
    ) return []
    const range = virtualDocument.generatedSpanToSourceRange(
      diagnostic.start,
      diagnostic.length ?? 1,
    )
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    const key = `${range.startLine}:${range.startColumn}:${message}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      source: "language" as const,
      severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" as const : "warning" as const,
      path: filePath,
      line: range.startLine,
      column: range.startColumn,
      message,
    }]
  })
}
