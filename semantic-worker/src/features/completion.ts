import { collectDocumentSymbolsForPath } from "./document-analysis.js"
import { loadWorkspace } from "../sdk/workspace-loader.js"
import { discoverHarmonySdk } from "../sdk/discovery.js"
import { completeArkuiApis } from "../sdk/arkui-api-index.js"

import type {
  SemanticTextRange,
  SemanticCompletionItem,
  SemanticDocumentPosition,
  SemanticResponsePayload,
} from "../protocol.js"
import type { ArkuiApiEntry } from "../sdk/arkui-api-index.js"

export function resolveCompletion(
  position: SemanticDocumentPosition | undefined,
): SemanticResponsePayload {
  if (!position) {
    return []
  }

  const workspace = loadWorkspace(position.path)
  const currentDocument = workspace.documents.find((document) => document.path === position.path)
  if (!currentDocument) {
    return []
  }

  const content = currentDocument.content

  const labels: SemanticCompletionItem[] = []
  const seen = new Set<string>()
  const push = (item: SemanticCompletionItem) => {
    if (!seen.has(item.label)) {
      seen.add(item.label)
      labels.push(item)
    }
  }

  if (content.includes("@Entry")) {
    push({ label: "@Entry", detail: "ArkTS decorator", kind: "keyword", source: "arkts" })
  }

  if (content.includes("@Component")) {
    push({ label: "@Component", detail: "ArkTS decorator", kind: "keyword", source: "arkts" })
  }

  if (content.includes("struct ") || content.includes("@Component")) {
    push({ label: "build()", detail: "Component lifecycle method", kind: "method", source: "arkts" })
  }

  for (const symbol of workspace.documents.flatMap((document) =>
    collectDocumentSymbolsForPath(document.content, document.path),
  )) {
    if (symbol.kind === "function") {
      push({
        label: `${symbol.name}()`,
        detail: "Semantic workspace function",
        kind: "function",
        source: "workspace",
      })
    }
  }

  const component = arkuiCompletionComponent(content, position)
  if (component) {
    const arkuiRange = arkuiCompletionReplacementRange(content, position)
    const sdkPath = discoverHarmonySdk().path ?? undefined
    for (const entry of completeArkuiApis(sdkPath, component)) {
      push({
        label: entry.name,
        detail: entry.signature || entry.detail,
        kind: "method",
        insertText: snippetForArkuiMethod(entry),
        filterText: entry.name,
        sortText: `0100-${entry.name}`,
        source: "arkui",
        documentation: entry.documentation ?? entry.detail,
        replacementRange: arkuiRange ?? undefined,
        commitCharacters: ["("],
        definitionTarget: { path: entry.path, line: entry.line, column: entry.column },
        data: { provider: "arkui-sdk", component: entry.component ?? null },
      })
    }
  }

  return labels
}

function arkuiCompletionComponent(
  content: string,
  position: SemanticDocumentPosition,
): string | null {
  const lines = content.split(/\r?\n/)
  const lineText = lines[position.line - 1] ?? ""
  const before = lineText.slice(0, Math.max(position.column - 1, 0))
  const sameLineMatch = before.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\.\s*[A-Za-z_$]*$/)
  if (sameLineMatch?.[1]) {
    return sameLineMatch[1]
  }

  if (!before.match(/[}.]\s*[A-Za-z_$]*$/)) {
    return null
  }

  for (let index = position.line - 2; index >= 0; index -= 1) {
    const candidate = lines[index]?.match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?:\{|$)/)
    if (candidate?.[1]) {
      return candidate[1]
    }
  }

  return null
}

function arkuiCompletionReplacementRange(
  content: string,
  position: SemanticDocumentPosition,
): SemanticTextRange | null {
  const lineText = content.split(/\r?\n/)[position.line - 1]
  if (lineText === undefined) {
    return null
  }

  const endColumn = position.column
  const before = lineText.slice(0, Math.max(endColumn - 1, 0))
  const prefix = before.match(/[A-Za-z_$][A-Za-z0-9_$]*$/)?.[0] ?? ""
  return {
    startLine: position.line,
    startColumn: endColumn - prefix.length,
    endLine: position.line,
    endColumn,
  }
}

function snippetForArkuiMethod(entry: Pick<ArkuiApiEntry, "name" | "signature">): string {
  const firstParam = entry.signature.match(/\(([^):,\s]+)/)?.[1] ?? "value"
  return `${entry.name}(\${1:${firstParam}})`
}
