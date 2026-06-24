import { collectDocumentSymbolsForPath } from "./document-analysis.js"
import { loadWorkspace } from "../sdk/workspace-loader.js"
import { discoverHarmonySdk } from "../sdk/discovery.js"
import { completeArkuiApis } from "../sdk/arkui-api-index.js"

import type {
  SemanticCompletionItem,
  SemanticDocumentPosition,
  SemanticResponsePayload,
} from "../protocol.js"

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
  const push = (label: string, detail: string, kind: string) => {
    if (!seen.has(label)) {
      seen.add(label)
      labels.push({ label, detail, kind })
    }
  }

  if (content.includes("@Entry")) {
    push("@Entry", "ArkTS decorator", "keyword")
  }

  if (content.includes("@Component")) {
    push("@Component", "ArkTS decorator", "keyword")
  }

  if (content.includes("struct ") || content.includes("@Component")) {
    push("build()", "Component lifecycle method", "method")
  }

  for (const symbol of workspace.documents.flatMap((document) =>
    collectDocumentSymbolsForPath(document.content, document.path),
  )) {
    if (symbol.kind === "function") {
      push(`${symbol.name}()`, "Semantic workspace function", "function")
    }
  }

  const component = arkuiCompletionComponent(content, position)
  if (component) {
    const sdkPath = discoverHarmonySdk().path
    for (const entry of completeArkuiApis(sdkPath, component)) {
      push(entry.name, entry.signature || entry.detail, "method")
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
