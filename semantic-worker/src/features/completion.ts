import { collectDocumentSymbolsForPath } from "./document-analysis.js"
import { loadWorkspace } from "../sdk/workspace-loader.js"

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

  return labels
}
